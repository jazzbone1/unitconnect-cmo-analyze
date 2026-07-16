import type { ChargerType, SettlementConfig } from '../lib/settlement'

export interface SiteInfo {
  name: string
  address: string
  households: number
}

export const EMPTY_SITE: SiteInfo = { name: '', address: '', households: 0 }

interface SiteInfoPanelProps {
  site: SiteInfo
  setSite: (s: SiteInfo) => void
  config: SettlementConfig
  setConfig: (c: SettlementConfig) => void
  onReset: () => void
}

/**
 * 단지 정보 + 충전기 종류별 수량·요금 입력 패널.
 * 파일 업로드 전에도 먼저 기입할 수 있으며, 값은 충전기 정산 분석에
 * 자동 적용된다.
 */
export default function SiteInfoPanel({
  site,
  setSite,
  config,
  setConfig,
  onReset,
}: SiteInfoPanelProps) {
  const totalCount = config.chargers.reduce((acc, c) => acc + c.count, 0)

  function updateCharger(id: string, patch: Partial<ChargerType>) {
    setConfig({
      ...config,
      chargers: config.chargers.map((c) =>
        c.id === id ? { ...c, ...patch } : c,
      ),
    })
  }

  return (
    <section className="card">
      <div className="card__header">
        <h2>단지 정보 · 충전기 설정</h2>
        <span className="badge">정산 분석에 자동 적용</span>
      </div>

      <div className="site-grid">
        <label className="var-field">
          <span className="var-field__label">단지명</span>
          <input
            className="var-field__input"
            type="text"
            value={site.name}
            placeholder="예: 흑석자이아파트"
            onChange={(e) => setSite({ ...site, name: e.target.value })}
          />
        </label>
        <label className="var-field">
          <span className="var-field__label">주소</span>
          <input
            className="var-field__input"
            type="text"
            value={site.address}
            placeholder="예: 서울시 동작구 …"
            onChange={(e) => setSite({ ...site, address: e.target.value })}
          />
        </label>
        <label className="var-field">
          <span className="var-field__label">세대수</span>
          <input
            className="var-field__input"
            type="number"
            min={0}
            value={site.households || ''}
            placeholder="0"
            onChange={(e) =>
              setSite({ ...site, households: Number(e.target.value) || 0 })
            }
          />
        </label>
        <div className="var-field">
          <span className="var-field__label">충전기 수량 (자동합계)</span>
          <div className="var-field__auto">{totalCount.toLocaleString()}기</div>
        </div>
      </div>

      <h3 className="subsection__title">충전기 종류별 수량·요금</h3>
      <div className="table-scroll">
        <table className="data-table charger-table">
          <thead>
            <tr>
              <th>충전기 종류</th>
              <th>수량(기)</th>
              <th>요금(원/kWh)</th>
            </tr>
          </thead>
          <tbody>
            {config.chargers.map((c) => (
              <tr key={c.id}>
                <td className="col-name">{c.name}</td>
                <td>
                  <input
                    className="cell-input"
                    type="number"
                    min={0}
                    placeholder="0"
                    value={c.count || ''}
                    onChange={(e) =>
                      updateCharger(c.id, { count: Number(e.target.value) || 0 })
                    }
                  />
                </td>
                <td>
                  <input
                    className="cell-input"
                    type="number"
                    min={0}
                    placeholder="0"
                    value={c.rate || ''}
                    onChange={(e) =>
                      updateCharger(c.id, { rate: Number(e.target.value) || 0 })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="var-actions">
        <label className="hours-field">
          월 가동시간(시간)
          <input
            className="cell-input"
            type="number"
            min={1}
            value={config.hours}
            onChange={(e) =>
              setConfig({ ...config, hours: Number(e.target.value) || 0 })
            }
          />
        </label>
        <button type="button" className="link-button" onClick={onReset}>
          수량·요금 모두 지우기
        </button>
      </div>
      <p className="var-hint">
        여기 입력한 단지 정보와 충전기 수량·요금이 아래 정산 분석에 자동
        적용됩니다. 요금·수량은 현장마다 다르니 사용하는 종류만 입력하세요.
      </p>
    </section>
  )
}
