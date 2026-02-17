export type AuthUser = {
  id: string
  email?: string
}

export type RequestUser = {
  id: string
  email?: string
  userType?: string
  isEmployee: boolean
  memberships: Array<{ company_id: string; role: string }>
}
