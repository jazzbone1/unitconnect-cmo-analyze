import { useEffect, useState } from 'react'
import {
  ssoHqMembers,
  ssoSaveHqMembers,
  ssoCurrentUser,
  ssoDirectory,
  type SsoAccount,
} from '../lib/sso'

/**
 * 본사 명단 관리 — 승인자 지정 명부를 채우기 위한 관리 화면.
 *  - 메신저 계정 API가 없어, 본사 담당 인원을 이 사이트에서 직접 등록/관리한다.
 *  - 저장된 명단은 로그인 자동수집 명부와 합쳐져 승인자 검색 드롭다운에 노출된다.
 *  - 계정ID는 메신저 SSO 식별자(=이름)와 동일하므로 이름만 넣으면 로그인 시 자동 매칭된다.
 */
export default function HqMembersPanel() {
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [members, setMembers] = useState<SsoAccount[]>([])
  const [roster, setRoster] = useState<SsoAccount[]>([])
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null)
  const [bulk, setBulk] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!open || loaded) return
    let alive = true
    ssoCurrentUser().then((u) => alive && setLoggedIn(!!u))
    ssoDirectory().then((list) => alive && setRoster(list))
    ssoHqMembers().then((list) => {
      if (!alive) return
      setMembers(list)
      setLoaded(true)
    })
    return () => {
      alive = false
    }
  }, [open, loaded])

  const addNames = (text: string) => {
    const names = text
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (names.length === 0) return
    setMembers((prev) => {
      const seen = new Set(prev.map((m) => m.id))
      const next = [...prev]
      for (const name of names) {
        if (seen.has(name)) continue
        seen.add(name)
        next.push({ id: name, name })
      }
      return next
    })
    setDirty(true)
    setBulk('')
    setMsg('')
  }

  const addAccount = (acc: SsoAccount) => {
    setMembers((prev) =>
      prev.some((m) => m.id === acc.id) ? prev : [...prev, acc],
    )
    setDirty(true)
    setMsg('')
  }

  const remove = (id: string) => {
    setMembers((prev) => prev.filter((m) => m.id !== id))
    setDirty(true)
    setMsg('')
  }

  const save = async () => {
    setBusy(true)
    setMsg('')
    try {
      const saved = await ssoSaveHqMembers(members)
      setMembers(saved)
      setDirty(false)
      setMsg(`저장 완료 · 본사 명단 ${saved.length}명`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hq-panel">
      <button
        type="button"
        className="hq-panel__toggle"
        onClick={() => setOpen((v) => !v)}
      >
        <span>본사 명단 관리{loaded ? ` (${members.length}명)` : ''}</span>
        <span className="hq-panel__chev">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="hq-panel__body">
          <p className="hq-panel__desc">
            승인자로 지정할 <b>본사 담당 인원</b>을 등록합니다. 여기 등록한
            이름은 승인자 검색 목록에 바로 나타납니다. 한 줄에 한 명씩(또는 쉼표로
            구분) 여러 명을 한 번에 추가할 수 있습니다. 이름은 메신저 로그인
            이름과 동일하게 입력하세요.
          </p>

          {loggedIn === false && (
            <p className="hq-panel__warn">
              로그인 후에만 저장할 수 있습니다. (DEALERCONNECT 로그인 또는 직접
              로그인)
            </p>
          )}

          {(() => {
            const have = new Set(members.map((m) => m.id))
            const sug = roster.filter((a) => !have.has(a.id))
            if (sug.length === 0) return null
            return (
              <div className="hq-panel__sug">
                <div className="hq-panel__sug-title">
                  로그인 이력이 있는 계정에서 추가
                </div>
                <div className="hq-panel__sug-chips">
                  {sug.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className="hq-panel__sug-chip"
                      onClick={() => addAccount(a)}
                    >
                      + {a.name}
                    </button>
                  ))}
                </div>
              </div>
            )
          })()}

          <div className="hq-panel__add">
            <textarea
              value={bulk}
              placeholder={'예)\n최동환\n김재환\n홍길동, 이순신'}
              rows={3}
              onChange={(e) => setBulk(e.target.value)}
            />
            <button
              type="button"
              className="hq-panel__add-btn"
              onClick={() => addNames(bulk)}
              disabled={!bulk.trim()}
            >
              + 명단에 추가
            </button>
          </div>

          {members.length === 0 ? (
            <p className="hq-panel__empty">등록된 본사 인원이 없습니다.</p>
          ) : (
            <ul className="hq-panel__list">
              {members.map((m) => (
                <li key={m.id} className="hq-panel__item">
                  <span className="hq-panel__name">{m.name}</span>
                  <button
                    type="button"
                    className="hq-panel__x"
                    aria-label={`${m.name} 제거`}
                    onClick={() => remove(m.id)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="hq-panel__actions">
            <button
              type="button"
              className="hq-panel__save"
              onClick={save}
              disabled={busy || !dirty}
            >
              {busy ? '저장 중…' : '명단 저장'}
            </button>
            {msg && <span className="hq-panel__msg">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
