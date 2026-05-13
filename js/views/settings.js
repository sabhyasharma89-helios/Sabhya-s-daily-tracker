import { el, toast, downloadJSON, pickFile, readFileAsText, confirmDialog, todayISO } from '../utils.js';
import { getCtx, refresh } from '../state.js';
import * as DB from '../db.js';

export async function renderSettings(root) {
  root.innerHTML = '';
  document.getElementById('topbar-sub').textContent = 'Settings';
  const ctx = getCtx();
  const p = ctx.profile;

  // Profile section
  const profCard = el('div', { class: 'card' });
  profCard.appendChild(el('div', { class: 'card-title' }, 'Profile'));
  const fields = [
    ['Name', 'name', 'text'],
    ['Age (years)', 'age_years', 'number'],
    ['Height (cm)', 'height_cm', 'number'],
    ['Target weight (kg)', 'target_weight_kg', 'number'],
    ['Target date', 'target_date', 'date']
  ];
  const inputs = {};
  for (const [label, key, type] of fields) {
    const input = el('input', { type, value: p[key] ?? '', step: type === 'number' ? '0.01' : '' });
    inputs[key] = input;
    profCard.appendChild(el('div', { class: 'form-row' }, [
      el('label', { class: 'form-label' }, label),
      input
    ]));
  }
  const actSel = el('select');
  for (const lvl of ['sedentary','light','moderate','active']) {
    const o = el('option', { value: lvl }, lvl);
    if (p.activity_level === lvl) o.selected = true;
    actSel.appendChild(o);
  }
  inputs.activity_level = actSel;
  profCard.appendChild(el('div', { class: 'form-row' }, [
    el('label', { class: 'form-label' }, 'Activity level'),
    actSel
  ]));

  profCard.appendChild(el('button', { class: 'btn btn-primary btn-block', onClick: async () => {
    const np = { ...p };
    for (const k of Object.keys(inputs)) {
      const v = inputs[k].value;
      if (k === 'age_years' || k === 'height_cm' || k === 'target_weight_kg') np[k] = parseFloat(v);
      else np[k] = v;
    }
    await DB.saveProfile(np);
    await refresh();
    toast('Saved');
    renderSettings(root);
  }}, 'Save profile'));
  root.appendChild(profCard);

  // Daily targets section
  const t = ctx.targets;
  const tCard = el('div', { class: 'card' });
  tCard.appendChild(el('div', { class: 'card-title' }, 'Daily targets'));
  tCard.appendChild(el('div', { class: 'text-sm muted mb-2' },
    `Computed: BMR ${t.bmr_kcal} · TDEE ${t.tdee_kcal} kcal`));

  const overrideFields = [
    ['Calorie intake target (kcal)', 'override_daily_calorie_target', t.daily_calorie_target_kcal],
    ['Exercise burn target (kcal)', 'override_daily_exercise_burn_target', t.daily_exercise_burn_target_kcal],
    ['Daily net deficit target (kcal)', 'override_daily_deficit_kcal', t.daily_net_deficit_target_kcal],
    ['Protein target (g)', 'override_daily_protein_target_g', t.daily_protein_target_g],
    ['Water target (ml)', 'override_daily_water_target_ml', t.daily_water_target_ml]
  ];
  const tInputs = {};
  for (const [label, key, def] of overrideFields) {
    const input = el('input', { type: 'number', value: p[key] ?? def, placeholder: `auto: ${def}` });
    tInputs[key] = input;
    tCard.appendChild(el('div', { class: 'form-row' }, [
      el('label', { class: 'form-label' }, label),
      input
    ]));
  }
  tCard.appendChild(el('div', { class: 'row' }, [
    el('button', { class: 'btn btn-block', onClick: async () => {
      const np = { ...p };
      for (const k of Object.keys(tInputs)) np[k] = null;
      await DB.saveProfile(np);
      await refresh(); renderSettings(root); toast('Reset to defaults');
    }}, 'Reset to auto'),
    el('button', { class: 'btn btn-primary btn-block', onClick: async () => {
      const np = { ...p };
      for (const k of Object.keys(tInputs)) {
        const v = tInputs[k].value;
        np[k] = v ? parseFloat(v) : null;
      }
      await DB.saveProfile(np);
      await refresh(); toast('Saved'); renderSettings(root);
    }}, 'Save targets')
  ]));
  root.appendChild(tCard);

  // AI Coach section
  const aiCard = el('div', { class: 'card' });
  aiCard.appendChild(el('div', { class: 'card-title' }, 'AI Coach'));
  aiCard.appendChild(el('div', { class: 'text-sm muted mb-2' },
    'Paste your Anthropic API key for full AI coaching. Without it, the Coach tab uses built-in rules.'));
  const keyIn = el('input', { type: 'password', value: p.anthropic_api_key || '', placeholder: 'sk-ant-…' });
  const modelIn = el('input', { type: 'text', value: p.ai_model || 'claude-sonnet-4-5', placeholder: 'claude-sonnet-4-5' });
  aiCard.appendChild(el('div', { class: 'form-row' }, [el('label', { class: 'form-label' }, 'API key'), keyIn]));
  aiCard.appendChild(el('div', { class: 'form-row' }, [el('label', { class: 'form-label' }, 'Model'), modelIn]));
  aiCard.appendChild(el('button', { class: 'btn btn-primary btn-block', onClick: async () => {
    const np = { ...p, anthropic_api_key: keyIn.value || null, ai_model: modelIn.value || 'claude-sonnet-4-5' };
    await DB.saveProfile(np); await refresh(); toast('Saved');
  }}, 'Save key'));
  root.appendChild(aiCard);

  // Data section
  const dataCard = el('div', { class: 'card' });
  dataCard.appendChild(el('div', { class: 'card-title' }, 'Data'));
  dataCard.appendChild(el('div', { class: 'col' }, [
    el('button', { class: 'btn btn-block', onClick: async () => {
      const data = await DB.exportAllData();
      downloadJSON(`fitcoach-backup-${todayISO()}.json`, data);
      await DB.setMeta('last_backup', todayISO());
      toast('Exported');
      renderSettings(root);
    }}, 'Export data'),
    el('button', { class: 'btn btn-block', onClick: async () => {
      const file = await pickFile();
      if (!file) return;
      try {
        const text = await readFileAsText(file);
        const data = JSON.parse(text);
        const replace = await confirmDialog(
          'Replace all current data with the imported file? (Cancel to merge instead.)',
          { title: 'Import data', confirmText: 'Replace' }
        );
        await DB.importAllData(data, replace ? 'replace' : 'merge');
        await refresh();
        toast('Imported');
        renderSettings(root);
      } catch (e) {
        toast('Import failed: invalid file');
      }
    }}, 'Import data'),
    el('button', { class: 'btn btn-danger btn-block', onClick: async () => {
      const ok = await confirmDialog(
        'This wipes ALL data including profile, food logs, weight history, and chat. This cannot be undone.',
        { title: 'Clear all data', confirmText: 'Clear everything', danger: true }
      );
      if (!ok) return;
      await DB.clearAllData();
      await refresh();
      location.reload();
    }}, 'Clear all data')
  ]));
  const lastBackup = await DB.getMeta('last_backup');
  if (lastBackup) {
    dataCard.appendChild(el('div', { class: 'text-xs muted mt-2' }, `Last backup: ${lastBackup}`));
  }
  root.appendChild(dataCard);

  // About
  const aboutCard = el('div', { class: 'card' });
  aboutCard.appendChild(el('div', { class: 'card-title' }, 'About'));
  aboutCard.appendChild(el('div', { class: 'text-sm muted' }, 'FitCoach v1.0 — personal vegetarian dietitian.'));
  aboutCard.appendChild(el('div', { class: 'text-xs muted mt-1' }, 'All data is stored locally on this device in IndexedDB. No backend, no analytics.'));
  root.appendChild(aboutCard);
}
