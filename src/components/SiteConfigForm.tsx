import { useRef, useState } from 'react'
import type { ChargerType, SettlementConfig } from '../lib/settlement'
import { parseBuildingPdf } from '../lib/buildingRegister'

export interface SiteInfo {
  name: string
  address: string
  households: number
  /** 총 주차대수 */
  parking: number
}

export const EMPTY_SITE: SiteInfo = {
  name: '',
  address: '',
  households: 0,
  parking: 0,
}

interface SiteConfigFormProps {
  site: SiteInfo
  setSite: (s: SiteInfo) => void
  config: SettlementConfig
  setConfig: (c: SettlementConfig) => void
  onReset: () => void
}

/** 단지 정보 + 충전기 종류별 수량·요금 편집 폼 (리스트/저장 버튼 제외) */
export default function SiteConfigForm({
  site,
  setSite,
  config,
  setConfig,
  onReset,
}: SiteConfigFormProps) {
  const totalCount = config.chargers.reduce((acc, c) => acc + c.count, 0)
  const pdfInput = useRef<HTMLInputElement>(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfMsg, setPdfMsg] = useState<string | null>(null)

  function updateCharger(id: string, patch: Partial<ChargerType>) {
    setConfig({
      ...config,
      chargers: config.chargers.map((c) =>
        c.id === id ? { ...c, ...patch } : c,
      ),
    })
  }

  async function handlePdf(file: File) {
    setPdfBusy(true)
    setPdfMsg(null)
    try {
      const info = await parseBuildingPdf(file)
      const filled: string[] = []
      const next = { ...site }
      if (info.name) {
        next.name = info.name
        filled.push('단지명')
      }
      if (info.address) {
        next.address = info.address
        filled.push('주소')
      }
      if (info.households != null) {
        next.households = info.households
        filled.push('세대수')
      }
      if (info.parking != null) {
        next.parking = info.parking
        filled.push('총주차대수')
      }
      setSite(next)
      setPdfMsg(
        filled.length > 0
          ? `자동 입력됨: ${filled.join(', ')} (수정 가능)`
          : '건축물대장에서 값을 찾지 못했습니다. 직접 입력해주세요.',
      )
    } catch {
      setPdfMsg('PDF를 읽지 못했습니다. 건축물대장 PDF가 맞는지 확인해주세요.')
    } finally {
      setPdfBusy(false)
    }
  }

  return (
    <div className="var-panel">
      <div className="pdf-import">
        <button
          type="button"
          className="btn-secondary"
          disabled={pdfBusy}
          onClick={() => pdfInput.current?.click()}
        >
          {pdfBusy ? '읽는 중…' : '📄 건축물대장 PDF로 자동입력'}
        </button>
        <input
          ref={pdfInput}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handlePdf(f)
            e.target.value = ''
          }}
        />
        {pdfMsg && <span className="pdf-import__msg">{pdfMsg}</span>}
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
        <label className="var-field">
          <span className="var-field__label">총 주차대수</span>
          <input
            className="var-field__input"
            type="number"
            min={0}
            value={site.parking || ''}
            placeholder="0"
            onChange={(e) =>
              setSite({ ...site, parking: Number(e.target.value) || 0 })
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
        여기 입력한 단지 정보와 충전기 수량·요금이 이용량 분석과 사업성 분석에
        자동 적용됩니다. 사용하는 종류만 입력하세요.
      </p>
    </div>
  )
}
