import { useState } from 'react'
import type { ChargerType, SettlementConfig } from '../lib/settlement'
import type { PreInstalledCharger } from '../lib/sites'
import { parseBuildingPdf } from '../lib/buildingRegister'
import Dropzone from './Dropzone'

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
  /** 기설치 충전기(기존 설치분) — 종류별 수량·운영사 */
  preInstalled?: PreInstalledCharger[]
  setPreInstalled?: (arr: PreInstalledCharger[]) => void
  /** EV 등록 대수 */
  evCount?: number
  setEvCount?: (n: number) => void
}

/** 단지 정보 + 충전기 종류별 수량·요금 편집 폼 (리스트/저장 버튼 제외) */
export default function SiteConfigForm({
  site,
  setSite,
  config,
  setConfig,
  onReset,
  preInstalled = [],
  setPreInstalled,
  evCount = 0,
  setEvCount,
}: SiteConfigFormProps) {
  const totalCount = config.chargers.reduce((acc, c) => acc + c.count, 0)
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

  const preOf = (kw: number) => preInstalled.find((p) => p.kw === kw)
  const updatePre = (kw: number, patch: Partial<PreInstalledCharger>) => {
    if (!setPreInstalled) return
    const i = preInstalled.findIndex((p) => p.kw === kw)
    const next = [...preInstalled]
    if (i > -1) next[i] = { ...next[i], ...patch }
    else next.push({ kw, count: 0, operator: '', ...patch })
    setPreInstalled(next)
  }
  const preTotal = preInstalled.reduce((a, p) => a + (p.count || 0), 0)

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
        <Dropzone
          onFiles={(fs) => fs[0] && handlePdf(fs[0])}
          disabled={pdfBusy}
          compact
          accept="application/pdf,.pdf"
          multiple={false}
          icon="📄"
          title={pdfBusy ? '읽는 중…' : '건축물대장 PDF 끌어다 놓기 또는 클릭'}
          hint="단지명·주소·세대수·총주차대수 자동 입력 (수정 가능)"
        />
        {pdfMsg && <p className="pdf-import__msg">{pdfMsg}</p>}
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
          <span className="var-field__label">총 주차면 수</span>
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
        {setEvCount && (
          <label className="var-field">
            <span className="var-field__label">EV 등록 대수</span>
            <input
              className="var-field__input"
              type="number"
              min={0}
              value={evCount || ''}
              placeholder="0"
              onChange={(e) => setEvCount(Number(e.target.value) || 0)}
            />
          </label>
        )}
        <div className="var-field">
          <span className="var-field__label">2% (주차면 기준·자동)</span>
          <div className="var-field__auto">
            {Math.round((site.parking || 0) * 0.02).toLocaleString()}기
          </div>
        </div>
        <div className="var-field">
          <span className="var-field__label">5% (주차면 기준·자동)</span>
          <div className="var-field__auto">
            {Math.round((site.parking || 0) * 0.05).toLocaleString()}기
          </div>
        </div>
        <div className="var-field">
          <span className="var-field__label">위차 적용 충전기 (자동합계)</span>
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
              <th>모자분리 여부</th>
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
                <td className="sep-cell">
                  <label
                    className="sep-check"
                    title="체크 시 모자분리 적용(EV 전용 계량기 분리)"
                  >
                    <input
                      type="checkbox"
                      checked={!!c.separated}
                      onChange={(e) =>
                        updateCharger(c.id, { separated: e.target.checked })
                      }
                    />
                    <span>{c.separated ? '모자분리' : '미적용'}</span>
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {setPreInstalled && (
        <>
          <h3 className="subsection__title">
            기설치 충전기 (기존 설치분){' '}
            <span className="subsection__sub">합계 {preTotal}기</span>
          </h3>
          <div className="table-scroll">
            <table className="data-table charger-table">
              <thead>
                <tr>
                  <th>충전기 종류</th>
                  <th>수량(기)</th>
                  <th>운영사(제조사)</th>
                </tr>
              </thead>
              <tbody>
                {config.chargers.map((c) => {
                  const pre = preOf(c.kw)
                  return (
                    <tr key={`pre-${c.id}`}>
                      <td className="col-name">{c.name}</td>
                      <td>
                        <input
                          className="cell-input"
                          type="number"
                          min={0}
                          placeholder="0"
                          value={pre?.count || ''}
                          onChange={(e) =>
                            updatePre(c.kw, {
                              count: Number(e.target.value) || 0,
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="cell-input cell-input--text"
                          type="text"
                          placeholder="예: 유닛커넥트 / 제조사"
                          value={pre?.operator ?? ''}
                          onChange={(e) =>
                            updatePre(c.kw, { operator: e.target.value })
                          }
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="var-hint">
            현장에 <b>이미 설치된</b> 충전기(타 운영사 포함)를 참고용으로 기록합니다.
            요금·모자분리와 무관하며, 사업성 계산에는 반영되지 않습니다.
          </p>
        </>
      )}

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
        자동 적용됩니다. 사용하는 종류만 입력하세요. <b>모자분리</b>를 체크한
        종류와 미적용 종류는 이후 보고서에서 분리 발행됩니다.
      </p>
    </div>
  )
}
