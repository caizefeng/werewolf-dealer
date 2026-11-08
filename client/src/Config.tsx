import { useState } from 'preact/hooks';
import {
  BOARDS,
  MULTI_ROLES,
  playerCountOf,
  presetConfig,
  totalCards,
  validateConfig,
  type GameConfig,
  type RoleCounts,
  type RuleOptions,
} from '../../shared/config.ts';
import { ROLE_IDS, ROLES, type RoleId } from '../../shared/roles.ts';
import { RoleIcon, factionClass } from './ui.tsx';

export function rolesSummary(roles: RoleCounts): string {
  return ROLE_IDS.filter((r) => (roles[r] ?? 0) > 0)
    .map((r) => ((roles[r] ?? 0) > 1 ? `${ROLES[r].name}×${roles[r]}` : ROLES[r].name))
    .join(' ');
}

function sameRoles(a: RoleCounts, b: RoleCounts): boolean {
  return ROLE_IDS.every((r) => (a[r] ?? 0) === (b[r] ?? 0));
}

const GROUPS: { title: string; pred: (r: RoleId) => boolean }[] = [
  { title: '神职', pred: (r) => ROLES[r].category === 'god' },
  { title: '平民', pred: (r) => ROLES[r].category === 'villager' },
  { title: '狼人', pred: (r) => ROLES[r].category === 'wolf' },
  { title: '特殊', pred: (r) => ROLES[r].category === 'treasure' },
];

export function ConfigEditor({ value, onChange }: { value: GameConfig; onChange: (c: GameConfig) => void }) {
  const [showRules, setShowRules] = useState(false);
  const roles = value.roles;
  const preset = BOARDS.find((b) => sameRoles(b.roles, roles));
  const players = playerCountOf(roles);
  const cards = totalCards(roles);
  const err = validateConfig(value);

  const setCount = (r: RoleId, n: number) => {
    const max = MULTI_ROLES.includes(r) ? 12 : 1;
    const next = { ...roles, [r]: Math.max(0, Math.min(max, n)) };
    if (!next[r]) delete next[r];
    onChange({ ...value, roles: next, boardName: BOARDS.find((b) => sameRoles(b.roles, next))?.name ?? '自定义' });
  };
  const setRule = <K extends keyof RuleOptions>(k: K, v: RuleOptions[K]) =>
    onChange({ ...value, rules: { ...value.rules, [k]: v } });

  return (
    <div class="config">
      <div class="section-title">选择板子</div>
      <div class="presets">
        {BOARDS.map((b) => {
          const on = preset?.id === b.id;
          return (
            <button
              type="button"
              key={b.id}
              class={`preset${on ? ' on' : ''}`}
              onClick={() => onChange(presetConfig(b.id))}
              aria-pressed={on}
            >
              <span class="preset-name">{b.name}</span>
              <span class="preset-sub">
                {playerCountOf(b.roles)}人{b.note ? ` · ${b.note}` : ''}
              </span>
            </button>
          );
        })}
        <div class={`preset custom${!preset ? ' on' : ''}`}>
          <span class="preset-name">自定义</span>
          <span class="preset-sub">调整下方数量</span>
        </div>
      </div>

      <div class="section-title">
        身份配置
        <span class="count-note">
          {players}名玩家{roles.treasure ? `（${cards}张牌，埋3张底牌）` : ''}
        </span>
      </div>
      <div class="role-groups">
        {GROUPS.map((g) => (
          <div class="role-group" key={g.title}>
            <div class="role-group-title">{g.title}</div>
            {ROLE_IDS.filter(g.pred).map((r) => {
              const n = roles[r] ?? 0;
              return (
                <div class={`role-row ${factionClass(r)}${n ? ' active' : ''}`} key={r}>
                  <span class="role-row-icon">
                    <RoleIcon role={r} size={20} />
                  </span>
                  <span class="role-row-name">
                    {ROLES[r].name}
                    <small>{ROLES[r].short}</small>
                  </span>
                  <span class="stepper">
                    <button type="button" aria-label={`减少${ROLES[r].name}`} disabled={n === 0} onClick={() => setCount(r, n - 1)}>
                      −
                    </button>
                    <b>{n}</b>
                    <button
                      type="button"
                      aria-label={`增加${ROLES[r].name}`}
                      disabled={!MULTI_ROLES.includes(r) && n >= 1}
                      onClick={() => setCount(r, n + 1)}
                    >
                      +
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {err && <div class="form-error">{err}</div>}

      <button type="button" class="section-title toggle" onClick={() => setShowRules(!showRules)} aria-expanded={showRules}>
        规则选项 <span class="count-note">{showRules ? '收起' : '京城大师赛默认，点击修改'}</span>
      </button>
      {showRules && (
        <div class="rules-form">
          <Toggle label="警长竞选" on={value.rules.sheriff} set={(v) => setRule('sheriff', v)} />
          <Select
            label="自爆吞警徽"
            value={value.rules.badgeSwallow}
            options={[
              ['double', '双爆吞警徽'],
              ['single', '单爆吞警徽'],
            ]}
            set={(v) => setRule('badgeSwallow', v as RuleOptions['badgeSwallow'])}
          />
          <Select
            label="女巫自救"
            value={value.rules.witchSelfSave}
            options={[
              ['never', '全程不能自救'],
              ['firstNight', '仅首夜可以自救'],
              ['always', '可以自救'],
            ]}
            set={(v) => setRule('witchSelfSave', v as RuleOptions['witchSelfSave'])}
          />
          <Toggle label="梦游者免疫毒药" on={value.rules.dreamBlocksPoison} set={(v) => setRule('dreamBlocksPoison', v)} />
          <Select
            label="双方同时达成胜利条件"
            value={value.rules.simultaneousWin}
            options={[
              ['wolf', '狼人阵营胜利'],
              ['good', '好人阵营胜利'],
              ['draw', '平局'],
            ]}
            set={(v) => setRule('simultaneousWin', v as RuleOptions['simultaneousWin'])}
          />
          <NumberField label="夜间操作时限（秒）" value={value.rules.actionSeconds} set={(v) => setRule('actionSeconds', v)} />
          <NumberField label="狼人商量时限（秒）" value={value.rules.wolfSeconds} set={(v) => setRule('wolfSeconds', v)} />
          <NumberField label="投票时限（秒）" value={value.rules.voteSeconds} set={(v) => setRule('voteSeconds', v)} />
          <NumberField label="上警报名时限（秒）" value={value.rules.signupSeconds} set={(v) => setRule('signupSeconds', v)} />
        </div>
      )}
    </div>
  );
}

function Toggle({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <label class="field">
      <span>{label}</span>
      <button type="button" class={`switch${on ? ' on' : ''}`} role="switch" aria-checked={on} onClick={() => set(!on)}>
        <i />
      </button>
    </label>
  );
}

function Select({
  label,
  value,
  options,
  set,
}: {
  label: string;
  value: string;
  options: [string, string][];
  set: (v: string) => void;
}) {
  return (
    <label class="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => set((e.target as HTMLSelectElement).value)}>
        {options.map(([v, t]) => (
          <option value={v} key={v}>
            {t}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberField({ label, value, set }: { label: string; value: number; set: (v: number) => void }) {
  return (
    <label class="field">
      <span>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={5}
        max={300}
        value={value}
        onChange={(e) => {
          const n = Math.round(Number((e.target as HTMLInputElement).value));
          if (Number.isFinite(n)) set(Math.max(5, Math.min(300, n)));
        }}
      />
    </label>
  );
}
