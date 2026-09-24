import { lazy, Suspense, useState } from 'react'
import {
  APPEARANCE_LABELS,
  BODY_PRESETS,
  DEFAULT_APPEARANCE,
  DEFAULT_PLAYER_NAME,
  HAIR_STYLES,
  MAX_NAME_LENGTH,
  PANTS_COLORS,
  PANTS_HEX,
  SHIRT_COLORS,
  SHIRT_HEX,
  SKIN_HEX,
  SKIN_TONES,
  normalizeName,
  randomAppearance,
  type CharacterAppearance,
} from '../game/entities/appearance'
import { sfx } from '../game/audio/sfx'
import { useUiStore } from '../stores/uiStore'

const CharacterPreview = lazy(() => import('./CharacterPreview'))

type Field = keyof CharacterAppearance

function OptionRow<K extends Field>({ label, field, options, value, swatches, onPick }: {
  label: string
  field: K
  options: readonly CharacterAppearance[K][]
  value: CharacterAppearance[K]
  swatches?: Record<string, string>
  onPick: (field: K, value: CharacterAppearance[K]) => void
}) {
  const names = APPEARANCE_LABELS[field] as Record<string, string>
  return (
    <div className="creation-row">
      <span className="creation-label">{label}</span>
      <div className="creation-options" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={option === value}
            aria-label={names[option]}
            title={names[option]}
            className={`${swatches ? 'swatch' : 'chip'}${option === value ? ' selected' : ''}`}
            style={swatches ? { background: swatches[option] } : undefined}
            onClick={() => onPick(field, option)}
          >
            {swatches ? '' : names[option]}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * New Game → Character Creation → confirm (and confirm overwrite when a save exists) → world.
 * Back never touches the save; the world is only created by "Bắt đầu". Appearance is cosmetic.
 */
export function CharacterCreation() {
  const saveSlot = useUiStore((s) => s.saveSlot)
  const busy = useUiStore((s) => s.busy)
  const cancel = useUiStore((s) => s.cancelCharacterCreation)
  const begin = useUiStore((s) => s.beginNewGame)
  const [name, setName] = useState('')
  const [look, setLook] = useState<CharacterAppearance>(DEFAULT_APPEARANCE)
  const [confirmOverwrite, setConfirmOverwrite] = useState(false)
  const hasData = saveSlot.kind === 'ready' || saveSlot.kind === 'incompatible' || saveSlot.kind === 'corrupt'
  const pick = <K extends Field>(field: K, value: CharacterAppearance[K]) => {
    sfx.play('ui')
    setLook((prev) => ({ ...prev, [field]: value }))
  }
  const start = () => {
    sfx.play('ui')
    if (hasData && !confirmOverwrite) {
      setConfirmOverwrite(true)
      return
    }
    void begin({ name: normalizeName(name), appearance: look })
  }

  return (
    <div className="overlay">
      <div className="panel panel-wide creation">
        <h2>Tạo nhân vật</h2>
        <div className="creation-body">
          <Suspense fallback={<div className="creation-preview" />}>
            <CharacterPreview appearance={look} />
          </Suspense>
          <div className="creation-form">
            <label className="creation-row">
              <span className="creation-label">Tên</span>
              {/* Uncontrolled on purpose: as a controlled input the production build dropped the first
                  keystrokes while the preview canvases started (React wrote the stale value back).
                  React never writes this DOM value; only an over-long name is trimmed here. */}
              <input
                className="creation-name"
                defaultValue=""
                placeholder={DEFAULT_PLAYER_NAME}
                onChange={(e) => {
                  const chars = Array.from(e.target.value)
                  if (chars.length > MAX_NAME_LENGTH) e.target.value = chars.slice(0, MAX_NAME_LENGTH).join('')
                  setName(e.target.value)
                }}
                aria-describedby="name-hint"
              />
            </label>
            <p id="name-hint" className="muted creation-hint">
              {Array.from(name.trim()).length}/{MAX_NAME_LENGTH} ký tự · để trống sẽ dùng “{DEFAULT_PLAYER_NAME}”
            </p>
            <OptionRow label="Dáng người" field="preset" options={BODY_PRESETS} value={look.preset} onPick={pick} />
            <OptionRow label="Kiểu tóc" field="hair" options={HAIR_STYLES} value={look.hair} onPick={pick} />
            <OptionRow label="Màu da" field="skin" options={SKIN_TONES} value={look.skin} swatches={SKIN_HEX} onPick={pick} />
            <OptionRow label="Áo" field="shirt" options={SHIRT_COLORS} value={look.shirt} swatches={SHIRT_HEX} onPick={pick} />
            <OptionRow label="Quần" field="pants" options={PANTS_COLORS} value={look.pants} swatches={PANTS_HEX} onPick={pick} />
            <p className="muted creation-hint">Ngoại hình không ảnh hưởng chỉ số, tốc độ hay tầm đánh.</p>
            <div className="actions actions-row">
              <button type="button" onClick={() => setLook(randomAppearance())}>
                Ngẫu nhiên
              </button>
              <button type="button" onClick={() => setLook(DEFAULT_APPEARANCE)}>
                Mặc định
              </button>
            </div>
          </div>
        </div>
        {confirmOverwrite ? (
          <div className="actions">
            <p className="save-warn">Bản lưu hiện tại sẽ bị xóa khi bắt đầu ván mới. Tiếp tục?</p>
            <button type="button" onClick={start} disabled={busy}>
              Xóa bản lưu và bắt đầu
            </button>
            <button type="button" onClick={() => setConfirmOverwrite(false)}>
              Hủy
            </button>
          </div>
        ) : (
          <div className="actions actions-row">
            <button type="button" onClick={cancel}>
              Quay lại
            </button>
            <button type="button" className="primary" onClick={start} disabled={busy}>
              Bắt đầu
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
