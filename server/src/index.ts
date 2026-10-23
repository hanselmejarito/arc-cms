import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { authRouter } from './routes/auth.js'
import { clinicalRouter } from './routes/clinical.js'
import { opsRouter } from './routes/ops.js'

const app = express()
const origin = process.env.CLIENT_ORIGIN || 'http://localhost:5173'
const ui = process.env.STATIC_DIR

app.disable('x-powered-by')
app.use(cors({ origin, credentials: true }))
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())

app.get('/api/health', (_req, res) => res.json({ ok: true }))
app.use('/api/auth', authRouter)
app.use('/api', clinicalRouter)
app.use('/api', opsRouter)

if (ui && fs.existsSync(ui)) {
  app.use(express.static(ui))
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    if (req.path.startsWith('/api')) return next()
    res.sendFile(path.join(ui, 'index.html'))
  })
}

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err)
  res.status(500).json({ error: err.message || 'Server error' })
})

const port = Number(process.env.PORT || 4000)
app.listen(port, '0.0.0.0', () => {
  console.log('ARC API listening on http://localhost:' + port)
})
