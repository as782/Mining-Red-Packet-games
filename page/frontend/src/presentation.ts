import type { HbMe } from '../../hb'
import { boardSize, isKind } from './game'
import type { BoardSize, Cell, FeedItem, Kind, LastResult, PrivateGame, PublicGame } from './game'

export type PresentationPhase = 'idle' | 'reveal' | 'effect' | 'transfer' | 'resolve' | 'transition'

export interface PresentationValues {
  game: PublicGame | null
  own: PrivateGame | null
  me: HbMe | null
}

export interface PresentationEffect {
  id: number
  cardId: number
  size: BoardSize
  index: number
  kind: Kind
  actor: string | null
  isOwn: boolean
  amountDelta: number
  chanceDelta: number
  blocked: boolean
  text: string
  targetIndex: number | null
  phase: Exclude<PresentationPhase, 'idle'>
}

export interface PresentationSnapshot extends PresentationValues {
  /** The old, confirmed faces remain available while the next card flips in. */
  transitionFrom: PublicGame | null
  effect: PresentationEffect | null
  phase: PresentationPhase
  busy: boolean
  /** At most one pending board snapshot; fast peer updates are coalesced. */
  queued: number
}

export interface PresentationOptions {
  onChange: (snapshot: PresentationSnapshot) => void
  schedule?: (callback: () => void, delay: number) => unknown
  cancel?: (handle: unknown) => void
}

export const presentationDurations = { reveal: 260, effect: 1500, transfer: 700, resolve: 380, transition: 1160 } as const
const reducedDurations = { reveal: 50, effect: 1200, transfer: 100, resolve: 100, transition: 120 } as const
type ActivePhase = Exclude<PresentationPhase, 'idle'>

interface Sequence {
  before: PresentationValues
  target: PresentationValues
  effect: PresentationEffect
  cell: Cell
  flipFrom: PublicGame | null
}

const emptyValues = (): PresentationValues => ({ game: null, own: null, me: null })

function compareGames(left: PublicGame, right: PublicGame) {
  return left.stats.digs - right.stats.digs || left.cardId - right.cardId
}

function matchesResult(result: LastResult | null | undefined, cardId: number, index: number, kind?: Kind): result is LastResult {
  return !!result && result.cardId === cardId && result.index === index && (kind === undefined || result.kind === kind) && isKind(result.kind)
}

function newOwnResult(before: PresentationValues, target: PresentationValues, cardId: number, index: number, kind?: Kind) {
  const own = target.own
  if (!own || own.actorKey !== (before.own?.actorKey ?? own.actorKey) || own.digs <= (before.own?.digs ?? 0)) return null
  return matchesResult(own.lastResult, cardId, index, kind) ? own.lastResult : null
}

/**
 * The displayed board deliberately trails confirmed SDK state. Nothing in this
 * controller rolls a tile or calculates a reward: kinds come from public cells,
 * a public lastMove/feed pair, or the submitting player's confirmed lastResult.
 */
export function createPresentationController(options: PresentationOptions) {
  const schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay))
  const cancel = options.cancel ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>))
  let latest = emptyValues()
  let displayed = emptyValues()
  let active: Sequence | null = null
  let pending: { input: string; before: PresentationValues } | null = null
  let stagedMe: HbMe | null = null
  let hasStagedMe = false
  // Private lastResult can precede its public packet. Retain only the proven
  // cells until public catches up; counters and all other hidden cells stay put.
  const confirmedCells = new Map<string, Cell>()
  // Peer cells already shown beside one's own dig: not animated again after it.
  const shownPeers = new Set<string>()
  let reducedMotion = false
  let disposed = false
  let timer: unknown
  let timerActive = false
  let timerGeneration = 0
  let nextId = 1
  let snapshot: PresentationSnapshot = { ...displayed, transitionFrom: null, effect: null, phase: 'idle', busy: false, queued: 0 }

  function waitingForOwnSync() {
    if (!hasStagedMe) return false
    const before = latest.me
    if (!before?.signedIn || !stagedMe?.signedIn) return before?.signedIn !== stagedMe?.signedIn
    return before.name !== stagedMe.name || before.pending !== stagedMe.pending || before.settled !== stagedMe.settled || before.claim?.amount !== stagedMe.claim?.amount
  }

  function currentValues(): PresentationValues {
    const game = latest.game
    if (!game || confirmedCells.size === 0) return { ...latest }
    const cells = game.cells.map(cell => cell.kind === null ? confirmedCells.get(`${game.cardId}:${cell.index}`) ?? cell : cell)
    return { ...latest, game: cells.some((cell, index) => cell !== game.cells[index]) ? { ...game, cells } : game }
  }

  function rememberCell(cardId: number, cell: Cell) {
    if (latest.game?.cardId === cardId && latest.game.cells[cell.index]?.kind === null) confirmedCells.set(`${cardId}:${cell.index}`, cell)
  }

  /** The cell one's own dig holds back on this card: on its way, or being shown. */
  function heldIndex(cardId: number) {
    if (pending) {
      const command = /^dig (\d+) (\d+)$/.exec(pending.input)
      return command && Number(command[1]) === cardId ? Number(command[2]) - 1 : null
    }
    return active?.effect.isOwn && active.effect.cardId === cardId ? active.effect.index : null
  }

  /**
   * Other players' cells on the shown card land as they arrive, whatever one's
   * own dig is doing; only its own cell (its count and feed line with it) and a
   * new card wait for its reveal. A board held through one's own dig showed
   * several cells, or a new card, at once in a busy room (2026-11-02).
   */
  function withPeers(base: PublicGame | null) {
    const game = latest.game
    if (!pending && !active?.effect.isOwn) return base
    if (!base || !game || game.cardId !== base.cardId || compareGames(game, base) <= 0) return base
    const held = heldIndex(base.cardId)
    const ownKey = latest.own?.actorKey
    const unshownOwn = (index: number, actorKey?: string) => base.cells[index]?.kind === null && (index === held || (actorKey !== undefined && actorKey === ownKey))
    const landed = game.cells.filter(cell => cell.kind !== null && !unshownOwn(cell.index, cell.actorKey) && base.cells[cell.index]?.kind === null)
    if (landed.length === 0) return base
    const counts = { ...base.counts }
    for (const cell of landed) {
      if (cell.kind !== null) counts[cell.kind] = Math.max(0, counts[cell.kind] - 1)
      shownPeers.add(`${base.cardId}:${cell.index}`)
    }
    return {
      ...base,
      cells: base.cells.map(cell => landed.find(peer => peer.index === cell.index) ?? cell),
      counts,
      feed: game.feed.filter(item => item.cardId !== base.cardId || !unshownOwn(item.index, item.actorKey)),
    }
  }

  function publish() {
    if (disposed) return
    const targetGame = active?.target.game ?? displayed.game
    const queued = latest.game && targetGame && compareGames(latest.game, targetGame) > 0 ? 1 : 0
    snapshot = {
      ...displayed,
      game: withPeers(displayed.game),
      transitionFrom: active?.flipFrom ?? null,
      effect: active ? { ...active.effect } : null,
      phase: active?.effect.phase ?? 'idle',
      busy: !!pending || !!active?.effect.isOwn || waitingForOwnSync(),
      queued,
    }
    options.onChange(snapshot)
  }

  function clearTimer() {
    timerGeneration++
    if (timerActive) cancel(timer)
    timerActive = false
  }

  function later(phase: ActivePhase) {
    clearTimer()
    const generation = timerGeneration
    const duration = !active?.effect.isOwn && phase === 'resolve'
      ? reducedMotion ? 100 : 300
      : (reducedMotion ? reducedDurations : presentationDurations)[phase]
    timerActive = true
    timer = schedule(() => {
      if (disposed || generation !== timerGeneration) return
      timerActive = false
      advance()
    }, duration)
  }

  function effectDetails(before: PresentationValues, target: PresentationValues, cardId: number, index: number, kind: Kind, feed?: FeedItem, cell?: Cell) {
    const result = newOwnResult(before, target, cardId, index, kind)
    const move = target.game?.lastMove
    const matchesMove = move?.cardId === cardId && move.index === index
    const isOwn = !!result || !!(target.own && (cell?.actorKey === target.own.actorKey || (matchesMove && move.actorKey === target.own.actorKey)))
    const previousChances = before.own?.chances ?? before.game?.rules.initialChances
    const newPeek = result?.kind === 'spyglass' ? target.own?.peeks.find(peek => peek.cardId === cardId && !before.own?.peeks.some(previous => previous.cardId === cardId && previous.index === peek.index)) : null
    return {
      size: result?.size ?? feed?.size ?? (matchesMove ? move.size : undefined) ?? (before.game?.cardId === cardId ? boardSize(before.game) : target.game?.cardId === cardId ? boardSize(target.game) : 5),
      actor: cell?.by ?? feed?.actor ?? (matchesMove ? move.name : null),
      isOwn,
      amountDelta: result?.amount ?? 0,
      chanceDelta: result && previousChances !== undefined ? (target.own?.chances ?? previousChances) - previousChances : 0,
      blocked: result?.blocked ?? false,
      text: result?.text ?? feed?.text ?? '',
      targetIndex: newPeek?.index ?? null,
    }
  }

  function landedValues(sequence: Sequence): PresentationValues {
    if (sequence.target.game?.cardId === sequence.before.game?.cardId) return { ...sequence.target }
    const old = sequence.before.game
    if (!old) return { ...sequence.target }
    const revealed = sequence.effect.cardId === old.cardId ? [sequence.cell] : []
    const last = sequence.target.game ? publicReveal(old, sequence.target.game)?.cell : null
    if (last && !revealed.some(cell => cell.index === last.index)) revealed.push(last)
    const counts = { ...old.counts }
    for (const cell of revealed) {
      if (cell.kind !== null && old.cells[cell.index]?.kind === null) counts[cell.kind] = Math.max(0, counts[cell.kind] - 1)
    }
    return {
      ...sequence.before,
      own: sequence.target.own,
      me: sequence.target.me,
      game: {
        ...old,
        cells: old.cells.map(cell => revealed.find(confirmed => confirmed.index === cell.index) ?? cell),
        counts,
        feed: sequence.target.game?.feed ?? old.feed,
      },
    }
  }

  function beginSequence(before: PresentationValues, target: PresentationValues, cell: Cell, feed?: FeedItem, resolved = false, cardId = before.game?.cardId) {
    if (!before.game || cardId === undefined || cell.kind === null) return
    const details = effectDetails(before, target, cardId, cell.index, cell.kind, feed, cell)
    active = {
      before,
      target: { ...target },
      cell,
      flipFrom: resolved ? before.game : null,
      effect: {
        id: nextId++,
        cardId,
        index: cell.index,
        kind: cell.kind,
        ...details,
        phase: resolved ? 'transition' : details.isOwn ? 'reveal' : 'resolve',
      },
    }
    // Other players' confirmed reveals belong on the board immediately. Only
    // the current player's reward needs the large explanation and HUD flight.
    displayed = resolved ? { ...target } : details.isOwn ? { ...before } : landedValues(active)
    publish()
    later(active.effect.phase)
  }

  function feedFor(game: PublicGame, cardId: number, index: number) {
    return game.feed.find(item => item.cardId === cardId && item.index === index && isKind(item.kind))
  }

  function publicReveal(before: PublicGame, target: PublicGame): { cell: Cell; feed?: FeedItem; resolved?: boolean } | null {
    if (compareGames(target, before) <= 0) return null
    const move = target.lastMove
    if (target.cardId === before.cardId) {
      // A coalesced packet may contain several reveals. Animate its latest
      // confirmed move and commit the remaining public cells with that packet.
      const changed = target.cells.filter(cell => cell.kind !== null && before.cells[cell.index]?.kind === null)
      const cell = changed.find(item => move?.cardId === before.cardId && move.index === item.index) ?? changed.at(-1)
      return cell ? { cell, feed: feedFor(target, before.cardId, cell.index) } : null
    }
    // The old deck is gone after a pearl/full card. A matching public event is
    // the only public evidence of what was under its final hidden tile.
    if (!move || move.cardId !== before.cardId || !before.cells[move.index]) return null
    const feed = target.feed.find(item => item.cardId === move.cardId && item.index === move.index && item.at === move.at && item.actor === move.name && isKind(item.kind))
    if (!feed) return null
    const knownKind = before.cells[move.index].kind
    if (knownKind !== null && knownKind !== feed.kind) return null
    // A private result may have finished before this public board arrived.
    // Keep the confirmed old faces and flip, without replaying its reward.
    return { cell: { index: move.index, kind: feed.kind, by: move.name, at: move.at, actorKey: move.actorKey }, feed, resolved: knownKind !== null }
  }

  function drive() {
    if (disposed || pending || active) return
    if (displayed.game) {
      const result = latest.own?.lastResult
      const proven = result && newOwnResult(displayed, latest, result.cardId, result.index)
      const oldCell = proven?.cardId === displayed.game.cardId ? displayed.game.cells[proven.index] : null
      if (proven && (!oldCell || oldCell.kind === null || oldCell.kind === proven.kind)) {
        const feed = latest.game ? feedFor(latest.game, proven.cardId, proven.index) : undefined
        const publicCell = latest.game?.cardId === proven.cardId ? latest.game.cells[proven.index] : null
        const move = latest.game?.lastMove
        const cell: Cell = publicCell?.kind === proven.kind ? publicCell : {
          index: proven.index,
          kind: proven.kind,
          actorKey: latest.own?.actorKey,
          by: feed?.actor ?? (latest.me?.signedIn ? latest.me.name : null),
          at: feed?.at ?? (move?.cardId === proven.cardId && move.index === proven.index ? move.at : null),
        }
        rememberCell(proven.cardId, cell)
        // A private packet can arrive after peers have already changed cards.
        // Explain its real reward without inserting an old result into the new
        // card, or replaying that card's completed transition.
        beginSequence(displayed, currentValues(), cell, feed, false, proven.cardId)
        return
      }
    }
    const target = currentValues()
    if (displayed.game && target.game) {
      const reveal = publicReveal(displayed.game, target.game)
      if (reveal && !(target.game.cardId === displayed.game.cardId && shownPeers.has(`${displayed.game.cardId}:${reveal.cell.index}`))) {
        beginSequence(displayed, target, reveal.cell, reveal.feed, reveal.resolved)
        return
      }
    }
    // A me-only packet does not establish which dig changed the private HUD.
    // Its coherent refresh (or a new lastResult) will release it.
    displayed = { ...target }
    publish()
  }

  function advance() {
    const sequence = active
    if (!sequence) return
    const phase = sequence.effect.phase
    if (phase === 'reveal') {
      sequence.effect.phase = 'effect'
    } else if (phase === 'effect') {
      sequence.effect.phase = 'transfer'
    } else if (phase === 'transfer') {
      // Rewards, remaining chances, shields, peeks and settlement status all
      // land after the showcase finishes its flight, before any card flip.
      displayed = landedValues(sequence)
      sequence.effect.phase = 'resolve'
    } else if (phase === 'resolve' && sequence.target.game?.cardId !== sequence.before.game?.cardId) {
      sequence.flipFrom = displayed.game
      displayed = { ...sequence.target }
      sequence.effect.phase = 'transition'
    } else {
      displayed = { ...sequence.target }
      active = null
      drive()
      return
    }
    publish()
    later(sequence.effect.phase)
  }

  function acceptOwn(own: PrivateGame | null) {
    if (!own || !latest.own || own.actorKey !== latest.own.actorKey) return true
    if (own.digs < latest.own.digs) return false
    return !(own.digs === latest.own.digs && latest.own.status === 'settled' && own.status !== 'settled')
  }

  function receive(update: Partial<PresentationValues>) {
    if (disposed) return
    let staleBundle = false
    if (update.game !== undefined) {
      const incoming = update.game
      if (!latest.game || (incoming && compareGames(incoming, latest.game) >= 0)) {
        if (incoming || !latest.game) latest.game = incoming
      } else staleBundle = true
      if (!staleBundle && incoming) {
        for (const key of confirmedCells.keys()) {
          const [cardId, index] = key.split(':').map(Number)
          if (incoming.cardId > cardId || (incoming.cardId === cardId && incoming.cells[index]?.kind !== null)) confirmedCells.delete(key)
        }
      }
    }
    if (update.own !== undefined) {
      if (acceptOwn(update.own)) latest.own = update.own
      else staleBundle = true
    }
    if (update.me !== undefined && !staleBundle) {
      const was = latest.me
      const next = update.me
      if (!(was?.signedIn && next?.signedIn && was.name === next.name && was.settled && !next.settled)) {
        stagedMe = next
        hasStagedMe = true
      }
    }
    const reference = pending?.before ?? active?.before ?? displayed
    const lastResult = latest.own?.lastResult
    const proof = lastResult && newOwnResult(reference, latest, lastResult.cardId, lastResult.index)
    const coherentBundle = update.game !== undefined && update.own !== undefined && update.me !== undefined && !staleBundle
    if (hasStagedMe && (coherentBundle || proof)) {
      latest.me = stagedMe
      hasStagedMe = false
    }
    if (pending) {
      publish()
      return
    }
    const terminal = latest.own?.status === 'settled' || (latest.me?.signedIn && latest.me.settled)
    if (coherentBundle && terminal && !proof && !active?.effect.isOwn) {
      clearTimer()
      active = null
      displayed = currentValues()
      publish()
      return
    }
    if (active) {
      if (!active.effect.isOwn && proof && !matchesResult(proof, active.effect.cardId, active.effect.index, active.effect.kind)) {
        // An own result takes priority over a peer's decorative presentation.
        clearTimer()
        active = null
        drive()
        return
      }
      // SDK public/private events can arrive separately. Enrich this animation
      // only with the private result for this exact confirmed move.
      const result = newOwnResult(active.before, latest, active.effect.cardId, active.effect.index, active.effect.kind)
      if (result) {
        const wasOwn = active.effect.isOwn
        active.target.own = latest.own
        active.target.me = latest.me
        const game = latest.game
        if (game && (game.cardId > active.effect.cardId || (game.cardId === active.effect.cardId && game.cells[active.effect.index]?.kind === active.effect.kind))) active.target.game = currentValues().game
        Object.assign(active.effect, effectDetails(active.before, active.target, active.effect.cardId, active.effect.index, active.effect.kind, undefined, active.cell))
        if (!wasOwn) {
          // Identity can be unknown until the first private packet. Promote its
          // confirmed reward to the full own sequence rather than letting the
          // short peer resolve silently consume its only feedback.
          const before = { ...displayed, own: active.before.own, me: active.before.me }
          const sequence = active
          clearTimer()
          active = null
          beginSequence(before, sequence.target, sequence.cell, undefined, false, sequence.effect.cardId)
          return
        }
        if (active.effect.phase === 'resolve' || active.effect.phase === 'transition') displayed = { ...displayed, own: active.target.own, me: active.target.me }
        if (active.effect.phase === 'resolve' && active.target.game?.cardId === active.before.game?.cardId) displayed.game = active.target.game
        if (active.effect.phase === 'transition') displayed.game = active.target.game
      }
      publish()
      return
    }
    drive()
  }

  function begin(input: string) {
    if (disposed || pending || active?.effect.isOwn || waitingForOwnSync()) return false
    if (active) {
      clearTimer()
      active = null
      displayed = currentValues()
    }
    pending = { input, before: { ...displayed } }
    publish()
    return true
  }

  function complete(input: string) {
    if (disposed || !pending || pending.input !== input) return
    const before = pending.before
    pending = null
    const command = /^dig (\d+) (\d+)$/.exec(input)
    const cardId = command ? Number(command[1]) : -1
    const index = command ? Number(command[2]) - 1 : -1
    const result = newOwnResult(before, latest, cardId, index)
    if (result && before.game?.cardId === cardId && before.game.cells[index]?.kind === null) {
      const game = latest.game
      const feed = game ? feedFor(game, cardId, index) : undefined
      const cell = game?.cardId === cardId ? game.cells[index] : null
      // A local lastResult also proves a pearl when its old public board has
      // already been replaced. Do not infer any other still-hidden cell.
      const revealed: Cell = cell?.kind === result.kind ? cell : { index, kind: result.kind, actorKey: latest.own?.actorKey, by: feed?.actor ?? (latest.me?.signedIn ? latest.me.name : null), at: feed?.at ?? null }
      rememberCell(cardId, revealed)
      beginSequence(before, currentValues(), revealed, feed)
      return
    }
    // A confirmed public actor key can precede the private SDK response. Keep
    // this submitted own move on its full path; names alone never prove it.
    if (command && before.game?.cardId === cardId && before.game.cells[index]?.kind === null && latest.game && latest.own) {
      const reveal = latest.game.cardId === cardId
        ? { cell: latest.game.cells[index], feed: feedFor(latest.game, cardId, index) }
        : publicReveal(before.game, latest.game)
      if (reveal?.cell.index === index && reveal.cell.kind !== null && effectDetails(before, latest, cardId, index, reveal.cell.kind, reveal.feed, reveal.cell).isOwn) {
        beginSequence(before, currentValues(), reveal.cell, reveal.feed)
        return
      }
    }
    // Denied, invalid, stale-card and cashout commands have no tile animation
    // of their own; what others did meanwhile plays as it would have (a card
    // changed under it flips, not jumps). drive() never re-uses the previous
    // lastResult: only a newer dig proves one.
    drive()
  }

  function setReducedMotion(value: boolean) {
    if (disposed || value === reducedMotion) return
    reducedMotion = value
    if (active) later(active.effect.phase)
  }

  function dispose() {
    if (disposed) return
    clearTimer()
    disposed = true
    active = null
    pending = null
  }

  return { getSnapshot: () => snapshot, receive, begin, complete, setReducedMotion, dispose }
}
