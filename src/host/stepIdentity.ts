import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'

const MINTED_ID_PREFIX = 'dshctx-'

export interface PreStepDecision {
  kind?: unknown
  messages?: unknown[]
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    'agent/pre-step'(
      this: Context,
      input: { agent: unknown; messages: unknown[]; signal: AbortSignal; step: number; turn: number },
      next: () => Promise<PreStepDecision>,
    ): Promise<PreStepDecision>
  }
}

function lacksId(message: unknown): boolean {
  if (typeof message !== 'object' || message === null) return false
  const id = (message as { id?: unknown }).id
  return typeof id !== 'string' || id === ''
}

function lacksRole(message: unknown): boolean {
  if (typeof message !== 'object' || message === null) return false
  const role = (message as { role?: unknown }).role
  return typeof role !== 'string' || role === ''
}

function isUnidentified(message: unknown): boolean {
  return lacksId(message) || lacksRole(message)
}

/**
 * Complete a decision message that would otherwise persist in a shape the
 * harness refuses to load: it needs a non-empty `id` and, once persisted as a
 * `user/message` event, `role: 'user'`. Fields the producer already supplied —
 * a real `id` or a real `role` — are preserved as-is.
 */
function completed(message: object): object {
  const record = message as Record<string, unknown>
  const next: Record<string, unknown> = { ...record }
  if (typeof record.role !== 'string' || record.role === '') next.role = 'user'
  if (typeof record.id !== 'string' || record.id === '') next.id = MINTED_ID_PREFIX + randomUUID()
  return next
}

export function identifiedMessages(messages: readonly unknown[]): unknown[] | undefined {
  let copy: unknown[] | undefined
  for (const [index, message] of messages.entries()) {
    if (!isUnidentified(message)) {
      copy?.push(message)
      continue
    }
    copy ??= messages.slice(0, index)
    copy.push(completed(message as object))
  }
  return copy
}

export function watchStepIdentity(ctx: Context): void {
  ctx.on('agent/pre-step', async (_input, next) => {
    const decision = await next()
    try {
      if (decision.kind !== 'enter' || !Array.isArray(decision.messages)) return decision
      const identified = identifiedMessages(decision.messages)
      return identified === undefined
        ? decision
        : { ...decision, messages: identified }
    } catch {
      return decision
    }
  }, { prepend: true })
}