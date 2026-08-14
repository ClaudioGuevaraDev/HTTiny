import type { KeyValueRow, RequestDocument, TreeNode } from './types'

const row = (id: string, key = '', value = '', description = ''): KeyValueRow => ({ id, enabled: true, key, value, description })
const req = (id: string, name: string, method: RequestDocument['method'], url: string, body = ''): RequestDocument => ({
  id,
  kind: 'http',
  name,
  method,
  url,
  dirty: false,
  params: url.includes('?') ? [row(`${id}-p1`, 'page', '1', 'Current page'), row(`${id}-p2`, 'limit', '20', 'Items per page')] : [row(`${id}-p1`)],
  headers: [row(`${id}-h1`, 'Accept', 'application/json'), row(`${id}-h2`)],
  body: { type: body ? 'json' : 'none', content: body },
  auth: { type: 'none', token: '', username: '', password: '' },
})

export const initialDocuments: Record<string, RequestDocument> = {
  login: req('login', 'Login', 'POST', 'https://api.httiny.dev/auth/login', '{\n  "email": "developer@example.com",\n  "password": "••••••••"\n}'),
  refresh: req('refresh', 'Refresh Token', 'POST', 'https://api.httiny.dev/auth/refresh', '{\n  "refreshToken": "{{refresh_token}}"\n}'),
  users: req('users', 'Get Users', 'GET', 'https://api.httiny.dev/users?page=1&limit=20'),
  user: req('user', 'Get User', 'GET', 'https://api.httiny.dev/users/42'),
  createUser: req(
    'createUser',
    'Create User',
    'POST',
    'https://api.httiny.dev/users',
    '{\n  "name": "Maya Chen",\n  "email": "maya@example.com",\n  "role": "developer"\n}',
  ),
  deleteUser: req('deleteUser', 'Delete User', 'DELETE', 'https://api.httiny.dev/users/42'),
  products: req('products', 'Get Products', 'GET', 'https://api.httiny.dev/products'),
  createProduct: req('createProduct', 'Create Product', 'POST', 'https://api.httiny.dev/products', '{\n  "name": "Mechanical Keyboard",\n  "price": 129.9\n}'),
  broken: req('broken', 'Connection Error', 'GET', 'https://refused.httiny.dev/health'),
}

const rnode = (requestId: string): TreeNode => ({
  id: `node-${requestId}`,
  type: 'request',
  requestId,
  name: initialDocuments[requestId].name,
})
export const initialTree: TreeNode[] = [
  {
    id: 'main',
    type: 'collection',
    name: 'HTTiny Demo',
    expanded: true,
    children: [
      { id: 'auth', type: 'folder', name: 'Auth', expanded: true, children: [rnode('login'), rnode('refresh')] },
      {
        id: 'users-folder',
        type: 'folder',
        name: 'Users',
        expanded: true,
        children: [rnode('users'), rnode('user'), rnode('createUser'), rnode('deleteUser')],
      },
      { id: 'products-folder', type: 'folder', name: 'Products', expanded: false, children: [rnode('products'), rnode('createProduct')] },
      { id: 'errors-folder', type: 'folder', name: 'Examples', expanded: false, children: [rnode('broken')] },
    ],
  },
]
