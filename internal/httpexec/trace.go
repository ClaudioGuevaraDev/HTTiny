package httpexec

import (
	"crypto/tls"
	"net/http"
	"net/http/httptrace"
	"strings"
	"sync"
	"time"
)

// Phase is one segment of the waterfall: where it starts and how long it lasts, both
// in milliseconds from the moment the send began.
//
// An offset rather than a bare duration, because five durations side by side say
// nothing about what happened when. With offsets the five read as one timeline, and
// a gap between two of them is itself information.
//
// Ms == 0 means the phase did not happen. That is not a fudge: a reused connection
// genuinely has no DNS, no TCP and no TLS, and Timings.Reused is what explains it.
type Phase struct {
	At int `json:"at"`
	Ms int `json:"ms"`
}

// Timings is where the time went.
//
// The five phases partition the total rather than overlapping, which is why TTFB here
// means the gap between the connection being ready and the first byte arriving —
// the server's own thinking time — and not the conventional "everything up to the
// first byte". It is what Chrome's waterfall labels "Waiting (TTFB)" for the same
// reason.
type Timings struct {
	DNS      Phase `json:"dns"`
	Connect  Phase `json:"connect"`
	TLS      Phase `json:"tls"`
	TTFB     Phase `json:"ttfb"`
	Download Phase `json:"download"`
	TotalMs  int   `json:"totalMs"`
	// The connection came from the idle pool, so nothing was resolved, dialled or
	// negotiated. The transport keeps 4 idle connections per host, which makes this
	// the ordinary case for a second send to the same place — and three empty bars
	// with no explanation read as a bug rather than as a fast request.
	Reused bool `json:"reused"`
}

// TLSInfo describes the connection the final response arrived on. Nil for http://.
type TLSInfo struct {
	Version     string `json:"version"`
	CipherSuite string `json:"cipherSuite"`
	// The protocol ALPN settled on — "h2" or "http/1.1". Empty if none was negotiated.
	ALPN string `json:"alpn"`
	// The handshake was skipped by resuming an earlier session, which is the TLS-level
	// twin of Reused above and explains a suspiciously quick negotiation.
	Resumed    bool   `json:"resumed"`
	ServerName string `json:"serverName"`
	// The leaf certificate. Empty when the peer sent none, which cannot happen for a
	// client but is cheap to be safe about.
	Subject   string   `json:"subject"`
	Issuer    string   `json:"issuer"`
	NotBefore string   `json:"notBefore"`
	NotAfter  string   `json:"notAfter"`
	DNSNames  []string `json:"dnsNames"`
}

// Hop is one redirect that was followed. The chain is otherwise invisible: the app
// follows redirects silently and only reports where it ended up.
type Hop struct {
	Status int `json:"status"`
	// The URL that answered with this redirect.
	URL string `json:"url"`
	// Where it pointed, verbatim from the Location header — so a relative one shows as
	// relative, which is what the server actually sent.
	Location string `json:"location"`
	// The method used for this hop. A 302 turns a POST into a GET, and seeing that is
	// most of the value of a chain.
	Method string `json:"method"`
	Ms     int    `json:"ms"`
}

// tracer collects httptrace callbacks for one send.
//
// Two things about it are not optional. The hooks run on transport goroutines and some
// of them fire after the request has finished, so every field is behind the mutex. And
// the trace lives on the *context*, which net/http copies onto each redirect hop — the
// documentation's "no hooks that span a series of redirected requests" describes the
// struct, not the context — so every hook here can fire several times in one send and
// none of them may assume it is the first.
type tracer struct {
	mu    sync.Mutex
	start time.Time

	// First start and last finish of each kind across the whole exchange. Summing the
	// intervals instead would double-count the two simultaneous dials that Happy
	// Eyeballs performs, which the stdlib documents can fire ConnectStart twice.
	dnsAt, dnsDone   time.Time
	connAt, connDone time.Time
	tlsAt, tlsDone   time.Time

	firstByte time.Time
	reused    bool

	hops []Hop
	// When the previous hop's clock started, so each hop reports its own elapsed time
	// rather than a running total.
	hopMark time.Time
}

func newTracer(start time.Time) *tracer {
	return &tracer{start: start, hopMark: start}
}

// mark records the earliest start and the latest finish for a phase.
func mark(first *time.Time, at time.Time) {
	if first.IsZero() {
		*first = at
	}
}

func (t *tracer) hooks() *httptrace.ClientTrace {
	return &httptrace.ClientTrace{
		DNSStart: func(httptrace.DNSStartInfo) {
			t.mu.Lock()
			defer t.mu.Unlock()
			mark(&t.dnsAt, time.Now())
		},
		DNSDone: func(httptrace.DNSDoneInfo) {
			t.mu.Lock()
			defer t.mu.Unlock()
			t.dnsDone = time.Now()
		},
		ConnectStart: func(string, string) {
			t.mu.Lock()
			defer t.mu.Unlock()
			mark(&t.connAt, time.Now())
		},
		ConnectDone: func(_, _ string, err error) {
			// Only a dial that succeeded. With dual-stack the loser's failure arrives
			// too, and letting it move the finish line would report time nobody waited.
			if err != nil {
				return
			}
			t.mu.Lock()
			defer t.mu.Unlock()
			t.connDone = time.Now()
		},
		TLSHandshakeStart: func() {
			t.mu.Lock()
			defer t.mu.Unlock()
			mark(&t.tlsAt, time.Now())
		},
		TLSHandshakeDone: func(_ tls.ConnectionState, err error) {
			if err != nil {
				return
			}
			t.mu.Lock()
			defer t.mu.Unlock()
			t.tlsDone = time.Now()
		},
		GotConn: func(info httptrace.GotConnInfo) {
			t.mu.Lock()
			defer t.mu.Unlock()
			// Only the first hop's answer. A redirect to the same host reuses the
			// connection the first hop opened, and reporting that as "reused" would
			// hide the handshake this send actually paid for.
			if len(t.hops) == 0 && t.firstByte.IsZero() {
				t.reused = info.Reused
			}
		},
		GotFirstResponseByte: func() {
			t.mu.Lock()
			defer t.mu.Unlock()
			// Overwritten on every hop, so this ends up being the *final* response's
			// first byte — which is what separates waiting from downloading.
			t.firstByte = time.Now()
		},
	}
}

// redirected records one followed hop. Called from CheckRedirect, on the client's own
// goroutine rather than the transport's — hence the same lock.
func (t *tracer) redirected(req *http.Request) {
	if req == nil || req.Response == nil {
		return
	}
	from := ""
	if req.Response.Request != nil && req.Response.Request.URL != nil {
		from = req.Response.Request.URL.String()
	}

	t.mu.Lock()
	defer t.mu.Unlock()
	now := time.Now()
	t.hops = append(t.hops, Hop{
		Status:   req.Response.StatusCode,
		URL:      from,
		Location: req.Response.Header.Get("Location"),
		// The method of the request about to go out. Comparing it with the previous
		// hop's is how a POST silently becoming a GET becomes visible.
		Method: req.Method,
		Ms:     int(now.Sub(t.hopMark).Milliseconds()),
	})
	t.hopMark = now
	// A new hop may open a new connection to a new host. Letting the phase marks stand
	// would attribute the second handshake to the first one's start.
	t.firstByte = time.Time{}
}

// timings folds the marks into the waterfall. `end` is when the body finished being
// read, which is what the app has always meant by "how long it took".
func (t *tracer) timings(end time.Time) Timings {
	t.mu.Lock()
	defer t.mu.Unlock()

	since := func(at time.Time) int {
		if at.IsZero() {
			return 0
		}
		return int(at.Sub(t.start).Milliseconds())
	}
	phase := func(from, to time.Time) Phase {
		if from.IsZero() || to.IsZero() || to.Before(from) {
			return Phase{}
		}
		return Phase{At: since(from), Ms: int(to.Sub(from).Milliseconds())}
	}

	out := Timings{
		DNS:     phase(t.dnsAt, t.dnsDone),
		Connect: phase(t.connAt, t.connDone),
		TLS:     phase(t.tlsAt, t.tlsDone),
		TotalMs: int(end.Sub(t.start).Milliseconds()),
		Reused:  t.reused,
	}

	// Waiting begins when the connection is ready. On a reused connection nothing had
	// to be set up, so it begins at the send itself.
	ready := t.start
	for _, at := range []time.Time{t.dnsDone, t.connDone, t.tlsDone} {
		if at.After(ready) {
			ready = at
		}
	}
	if !t.firstByte.IsZero() {
		out.TTFB = phase(ready, t.firstByte)
		out.Download = phase(t.firstByte, end)
	}
	return out
}

func (t *tracer) redirects() []Hop {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.hops
}

// tlsInfoOf copies the scalars out of the connection state.
//
// A copy rather than the pointer, which net/http documents is shared between responses
// and must not be modified. `tls.VersionName` and `tls.CipherSuiteName` never fail —
// they fall back to a hex form for anything they do not know — so nothing here needs
// an error path.
func tlsInfoOf(state *tls.ConnectionState) *TLSInfo {
	if state == nil {
		return nil
	}
	out := &TLSInfo{
		Version:     tls.VersionName(state.Version),
		CipherSuite: tls.CipherSuiteName(state.CipherSuite),
		ALPN:        state.NegotiatedProtocol,
		Resumed:     state.DidResume,
		ServerName:  state.ServerName,
	}
	if len(state.PeerCertificates) > 0 {
		leaf := state.PeerCertificates[0]
		out.Subject = nameOf(leaf.Subject.CommonName, leaf.Subject.Organization)
		out.Issuer = nameOf(leaf.Issuer.CommonName, leaf.Issuer.Organization)
		out.NotBefore = leaf.NotBefore.UTC().Format(time.RFC3339)
		out.NotAfter = leaf.NotAfter.UTC().Format(time.RFC3339)
		out.DNSNames = leaf.DNSNames
	}
	return out
}

// nameOf prefers the common name and falls back to the organisation, because a
// certificate issued for a wildcard often leaves CN empty and only the O is readable.
func nameOf(commonName string, organization []string) string {
	if commonName != "" {
		return commonName
	}
	return strings.Join(organization, ", ")
}
