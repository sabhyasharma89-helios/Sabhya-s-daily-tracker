import { Chart, registerables } from 'chart.js';
import { el, isoOffset, todayISO, fmtKg, daysBetween } from '../utils.js';
import { getCtx } from '../state.js';
import * as DB from '../db.js';
import { projectedWeightForDate } from '../profile.js';

Chart.register(...registerables);

let activeRange = 30;

export async function renderTrends(root) {
  root.innerHTML = '';
  document.getElementById('topbar-sub').textContent = 'Trends';
  const ctx = getCtx();

  // Range pills
  const pill = el('div', { class: 'toggle-pill mb-2' });
  for (const r of [7,30,90,365,9999]) {
    const lbl = r === 7 ? '7d' : r === 30 ? '30d' : r === 90 ? '90d' : r === 365 ? '1y' : 'All';
    const b = el('button', { class: activeRange === r ? 'active' : '', onClick: () => { activeRange = r; renderTrends(root); } }, lbl);
    pill.appendChild(b);
  }
  root.appendChild(pill);

  // Weight chart
  const weights = ctx.weights.filter(w => activeRange >= 9999 || daysBetween(w.date, todayISO()) <= activeRange);
  const weightCard = el('div', { class: 'card' });
  weightCard.appendChild(el('div', { class: 'card-title' }, 'Weight'));
  if (weights.length < 2) {
    weightCard.appendChild(el('div', { class: 'text-sm muted' }, 'Log a few weight entries to see your trend.'));
  } else {
    const canvas = el('canvas', { id: 'weightChart', height: '180' });
    weightCard.appendChild(canvas);
    setTimeout(() => drawWeightChart(canvas, weights, ctx), 50);

    const last = weights[weights.length - 1];
    const first = weights[0];
    const change = last.weight_kg - first.weight_kg;
    const chgColor = change < 0 ? 'green' : change > 0 ? 'red' : '';
    weightCard.appendChild(el('div', { class: 'kpi-row mt-2' }, [
      kpi('Current', `${fmtKg(last.weight_kg)} kg`),
      kpi('Change', `${change >= 0 ? '+' : ''}${change.toFixed(1)} kg`, chgColor),
      kpi('BMI', String(last.bmi))
    ]));
  }
  root.appendChild(weightCard);

  // Calorie in vs out chart (last N days)
  const calCard = el('div', { class: 'card' });
  calCard.appendChild(el('div', { class: 'card-title' }, 'Calories in vs out'));
  const calCanvas = el('canvas', { height: '180' });
  calCard.appendChild(calCanvas);
  setTimeout(() => drawCalChart(calCanvas, Math.min(activeRange, 30), ctx), 50);
  root.appendChild(calCard);

  // Adherence heatmap (last 90 days)
  const heatCard = el('div', { class: 'card' });
  heatCard.appendChild(el('div', { class: 'card-title' }, 'Adherence (last 90 days)'));
  heatCard.appendChild(await buildHeatmap(ctx, 90));
  heatCard.appendChild(el('div', { class: 'text-xs muted mt-1' },
    'Green = day hit calorie target. Darker = bigger deficit.'));
  root.appendChild(heatCard);

  // Projected target date
  const projCard = el('div', { class: 'card' });
  projCard.appendChild(el('div', { class: 'card-title' }, 'Projection'));
  projCard.appendChild(buildProjection(ctx));
  root.appendChild(projCard);
}

function kpi(label, val, cls = '') {
  return el('div', { class: 'kpi' }, [
    el('div', { class: 'kpi-label' }, label),
    el('div', { class: 'kpi-val ' + cls }, val)
  ]);
}

let _weightChart, _calChart;

function drawWeightChart(canvas, weights, ctx) {
  if (_weightChart) _weightChart.destroy();
  const labels = weights.map(w => w.date);
  const data = weights.map(w => w.weight_kg);
  const targetLine = weights.map(w => projectedWeightForDate(ctx.profile, w.date));

  _weightChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Actual', data, borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.15)', tension: 0.3, fill: true, pointRadius: 2 },
        { label: 'Target trajectory', data: targetLine, borderColor: '#60a5fa', borderDash: [4,4], pointRadius: 0, fill: false }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#a1a1aa' } } },
      scales: {
        x: { ticks: { color: '#71717a', maxTicksLimit: 5 }, grid: { color: '#2a2a2a' } },
        y: { ticks: { color: '#71717a' }, grid: { color: '#2a2a2a' } }
      }
    }
  });
}

async function drawCalChart(canvas, days, ctx) {
  const labels = [];
  const dates = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = isoOffset(-i);
    dates.push(d);
    labels.push(d.slice(5));
  }
  const inArr = [], outArr = [];
  for (const d of dates) {
    const food = await DB.getFoodLog(d);
    const ex = await DB.getExerciseLog(d);
    inArr.push(food.reduce((s,f) => s + (f.kcal||0), 0));
    outArr.push(ex.reduce((s,e) => s + (e.kcal_burned||0), 0));
  }
  if (_calChart) _calChart.destroy();
  _calChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'In', data: inArr, backgroundColor: 'rgba(251,191,36,0.7)' },
        { label: 'Out (exercise)', data: outArr, backgroundColor: 'rgba(52,211,153,0.7)' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#a1a1aa' } } },
      scales: {
        x: { ticks: { color: '#71717a', maxTicksLimit: 7 }, grid: { color: '#2a2a2a' } },
        y: { ticks: { color: '#71717a' }, grid: { color: '#2a2a2a' } }
      }
    }
  });
}

async function buildHeatmap(ctx, days) {
  const grid = el('div', { class: 'heatmap-grid' });
  const target = ctx.targets.daily_calorie_target_kcal;
  for (let i = days - 1; i >= 0; i--) {
    const d = isoOffset(-i);
    const food = await DB.getFoodLog(d);
    const kcal = food.reduce((s,f) => s + (f.kcal||0), 0);
    if (kcal === 0) {
      grid.appendChild(el('div', { class: 'heatmap-cell', title: `${d}: no data` }));
      continue;
    }
    const surplus = target - kcal;
    let cls = 'heatmap-cell';
    if (surplus > 0 && surplus < 100) cls += ' l1';
    else if (surplus >= 100 && surplus < 300) cls += ' l2';
    else if (surplus >= 300 && surplus < 600) cls += ' l3';
    else if (surplus >= 600) cls += ' l4';
    grid.appendChild(el('div', { class: cls, title: `${d}: ${Math.round(kcal)} kcal` }));
  }
  return grid;
}

function buildProjection(ctx) {
  const ws = ctx.weights || [];
  const wrap = el('div');
  if (ws.length < 7) {
    wrap.appendChild(el('div', { class: 'text-sm muted' }, 'Need at least 7 days of weight data to project.'));
    return wrap;
  }
  // Linear regression over last 14 days (or available)
  const recent = ws.slice(-14);
  const start = recent[0];
  const end = recent[recent.length - 1];
  const daysSpan = daysBetween(start.date, end.date) || 1;
  const dailyChange = (end.weight_kg - start.weight_kg) / daysSpan;
  const togo = end.weight_kg - ctx.profile.target_weight_kg;

  if (dailyChange >= 0) {
    wrap.appendChild(el('div', { class: 'text-sm muted' }, 'Trend is flat or up — focus on the next week\'s plan to restart loss.'));
    return wrap;
  }
  const daysToTarget = Math.ceil(togo / -dailyChange);
  const targetDate = new Date(Date.now() + daysToTarget * 86400000);
  const original = ctx.profile.target_date;

  wrap.appendChild(el('div', { class: 'text-sm' },
    `At current pace (${(dailyChange*7).toFixed(2)} kg/week), you'll hit ${ctx.profile.target_weight_kg} kg around ${targetDate.toISOString().slice(0,10)}.`));
  wrap.appendChild(el('div', { class: 'text-xs muted mt-1' }, `Original target: ${original}.`));
  return wrap;
}
