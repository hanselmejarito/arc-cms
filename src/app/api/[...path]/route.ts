import { NextRequest } from 'next/server'
import { dispatch } from '../../../../lib/dispatch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 10

export const GET = (request: NextRequest) => dispatch(request)
export const POST = (request: NextRequest) => dispatch(request)
export const PATCH = (request: NextRequest) => dispatch(request)
export const PUT = (request: NextRequest) => dispatch(request)
export const DELETE = (request: NextRequest) => dispatch(request)
