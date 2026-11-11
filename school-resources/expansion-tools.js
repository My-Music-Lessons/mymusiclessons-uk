import { calculateDemand, calculateTrust, demandCsv, trustCsv, escapeHtml } from './expansion-math.js';

const number = value => value.toLocaleString('en-GB');
const money = pennies => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pennies / 100);
const moneyOrUnknown = pennies => pennies === null ? 'Unknown' : money(pennies);
const table = (label, headers, rows) => `<div class="resource-table-wrap expansion-table" role="region" tabindex="0" aria-label="${label}"><p class="expansion-scroll-hint">Scroll the table sideways to compare every column.</p><table><caption>${label}</caption><thead><tr>${headers.map(header => `<th scope="col">${header}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;

function renderDemand(result) {
  const rows = result.rows.map(row => `<tr><th scope="row">${row.label}</th><td>${number(row.demand)}</td><td>${number(row.available)}</td><td>${number(row.feasible)}</td><td>${number(row.gap)}</td><td>${number(row.extraEquipment)}</td><td>${row.windows === null ? 'Equipment needed first' : number(row.windows)}</td></tr>`);
  const gaps = result.rows.filter(row => row.extraEquipment > 0);
  return `<div class="expansion-summary"><div><strong>${number(result.totalFeasible)}</strong><span>feasible instrument places in one window</span></div><div><strong>${number(result.totalGap)}</strong><span>interest selections beyond that window</span></div><div><strong>${number(result.rotations)}</strong><span>chosen rotations in each window</span></div></div><p>The ${number(result.totalDemand)} interest selections may include the same pupil more than once. Places below reflect equipment only; they are not confirmed offers or individual allocations.</p>${table('Equipment and phased opportunities by instrument', ['Instrument', 'Interest', 'Available at once', 'Feasible places', 'Unmet interest', 'Extra equipment for one window', 'Repeated windows with current equipment'], rows)}<p class="expansion-callout">${gaps.length ? 'Two routes to discuss: repeat the planning window with different pupils where equipment exists, or source more suitable equipment. Borrow, hire, repair, reuse and buy are options to investigate with actual availability and quotes.' : 'Your entered equipment and rotations cover all entered interest in this model. Confirm the actual timetable, support and workable setup before offering places.'}</p><h4>Your optional quote estimates</h4><p><strong>${money(result.knownEstimatePennies)}</strong> known extra-equipment subtotal, from ${number(result.knownQuotes)} instrument ${result.knownQuotes === 1 ? 'gap' : 'gaps'} with a unit quote. <strong>${number(result.missingQuotes)}</strong> instrument ${result.missingQuotes === 1 ? 'gap is' : 'gaps are'} missing a quote. This is a partial estimate for the sourcing option you priced, not a complete budget or a My Music Lessons quote.</p>${gaps.length ? table('Quotes for extra equipment indicated by this scenario', ['Instrument', 'Extra units', 'Your unit quote', 'Known estimate'], gaps.map(row => `<tr><th scope="row">${row.label}</th><td>${number(row.extraEquipment)}</td><td>${moneyOrUnknown(row.quotePennies)}</td><td>${moneyOrUnknown(row.estimatePennies)}</td></tr>`)) : '<p>No extra equipment is indicated by your inputs, so no additional unit quotes are used.</p>'}<p class="resource-assumptions">Feasible places = min(interest, available equipment × ${result.rotations} rotations). Repeated windows assume different pupils each time and unchanged equipment. They do not represent ongoing weekly places. Extra equipment is rounded up to whole units. Unknown quotes stay unknown; local free provision is not assumed. Check space, instrument condition, accessibility, supervision, session length and supplier arrangements separately.</p>`;
}

function renderTrust(result) {
  if (!result.rows.length) return '<p>No schools are in this comparison. Add a school and enter its assumptions to build a useful worksheet.</p>';
  const rows = result.rows.map(row => `<tr><th scope="row">${escapeHtml(row.school)}</th><td>${row.phase}</td><td>${number(row.participants)}</td><td>${number(row.weeklyPlaces)}</td><td>${number(row.gap)}</td><td>${row.windows === null ? 'Capacity needed first' : number(row.windows)}</td></tr>`);
  return `<div class="expansion-summary"><div><strong>${number(result.rows.length)}</strong><span>schools in this discussion</span></div><div><strong>${number(result.totalParticipants)}</strong><span>planned participants across the schools</span></div><div><strong>${number(result.totalGap)}</strong><span>combined site-level first-window gaps</span></div></div><p>Schools have entered ${number(result.totalWeeklyPlaces)} assumed weekly places in total. Capacity remains with its school: spare places elsewhere do not cancel a school’s gap.</p>${table('School comparison using your assumed weekly windows', ['School', 'Chosen phase', 'Participants', 'Places per weekly window', 'First-window gap', 'Repeated weekly windows'], rows)}<h4>Known costs, with the gaps kept visible</h4><dl class="expansion-cost-totals"><div><dt>Known setup subtotal</dt><dd>${money(result.setupKnownPennies)}<small>${result.setupMissing} of ${result.rows.length} setup estimates missing</small></dd></div><div><dt>Known weekly subtotal</dt><dd>${money(result.weeklyKnownPennies)}<small>${result.weeklyMissing} of ${result.rows.length} weekly estimates missing</small></dd></div></dl><p><strong>${number(result.missingEstimates)} of ${result.rows.length * 2} cost estimates are unknown.</strong> Subtotals include known amounts only; blank estimates have not become zero costs. There is no assumed full-period total.</p><div class="expansion-site-results">${result.rows.map(row => `<section class="expansion-site-result"><h4>${escapeHtml(row.school)}</h4><dl><div><dt>Responsible role</dt><dd>${escapeHtml(row.role)}</dd></div><div><dt>Chosen phase</dt><dd>${row.phase}</dd></div><div><dt>Setup estimate</dt><dd>${moneyOrUnknown(row.setupPennies)}</dd></div><div><dt>Weekly estimate</dt><dd>${moneyOrUnknown(row.weeklyPennies)}</dd></div></dl></section>`).join('')}</div><p class="resource-assumptions">Repeated weekly windows = participants ÷ assumed places per window, rounded up, with different participants in each window. A figure of 0 means no participants are planned. Where places are zero, capacity must be established first. This worksheet does not confirm ongoing places, school permissions, readiness, safety, access, supported ages or platform concurrency. Explore, Prepare and Review are chosen discussion labels. These are school-entered estimates, not My Music Lessons prices.</p>`;
}

function downloadCsv(content, filename) {
  const blob = new Blob(['\uFEFF', content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function enhance(root, type) {
  const form = root.querySelector('[data-expansion-form]');
  const resultPanel = root.querySelector('[data-expansion-result]');
  const output = root.querySelector('[data-expansion-output]');
  const message = root.querySelector('[data-expansion-message]');
  const printButton = root.querySelector('[data-expansion-print]');
  const csvButton = root.querySelector('[data-expansion-csv]');
  let latest = null;
  const calculateButton = root.querySelector('[data-expansion-calculate]');
  calculateButton.disabled = false;

  function invalidate(text = 'Your assumptions changed. Build a new result to print or export the current figures.') {
    latest = null;
    resultPanel.hidden = true;
    output.replaceChildren();
    printButton.disabled = true;
    csvButton.disabled = true;
    message.textContent = text;
    message.classList.remove('expansion-error');
  }

  form.addEventListener('input', () => invalidate());
  form.addEventListener('change', () => invalidate());
  if (type === 'trust') {
    const schools = root.querySelector('[data-trust-schools]');
    const add = root.querySelector('[data-trust-add]');
    let nextId = 8;
    function refreshSchools() {
      const rows = [...schools.querySelectorAll('[data-trust-row]')];
      rows.forEach((row, index) => {
        row.querySelector('[data-school-number]').textContent = index + 1;
        row.querySelector('[data-trust-remove]').setAttribute('aria-label', `Remove school ${index + 1}`);
      });
      root.querySelector('[data-trust-count]').textContent = `${rows.length} of 8 schools`;
      root.querySelector('[data-trust-empty]').hidden = rows.length > 0;
      add.disabled = rows.length >= 8;
    }
    add.addEventListener('click', () => {
      if (schools.querySelectorAll('[data-trust-row]').length >= 8) return;
      const clone = root.querySelector('[data-trust-template]').content.cloneNode(true);
      const id = nextId++;
      clone.querySelectorAll('[id]').forEach(element => { element.id = element.id.replace('trust-new-', `trust-${id}-`); });
      clone.querySelectorAll('label[for]').forEach(label => { label.htmlFor = label.htmlFor.replace('trust-new-', `trust-${id}-`); });
      const schoolInput = clone.querySelector('[data-trust-school]');
      schoolInput.value = '';
      schoolInput.placeholder = 'Your school label';
      schools.append(clone);
      refreshSchools();
      invalidate('School added with zero participants and places. Enter its assumptions, then rebuild the comparison.');
      schoolInput.focus();
    });
    schools.addEventListener('click', event => {
      const remove = event.target.closest('[data-trust-remove]');
      if (!remove) return;
      const row = remove.closest('[data-trust-row]');
      const focusTarget = row.nextElementSibling?.querySelector('[data-trust-school]') || row.previousElementSibling?.querySelector('[data-trust-school]') || add;
      row.remove();
      refreshSchools();
      invalidate('School removed. Build the comparison again to use the remaining schools.');
      focusTarget.focus();
    });
    refreshSchools();
  }

  calculateButton.addEventListener('click', () => {
    invalidate();
    try {
      if (type === 'demand') {
        latest = calculateDemand({ rotations: root.querySelector('[data-demand-rotations]').value, rows: [...root.querySelectorAll('[data-demand-row]')].map(row => ({ instrument: row.dataset.demandRow, demand: row.querySelector('[data-demand-interest]').value, available: row.querySelector('[data-demand-available]').value, unitQuote: row.querySelector('[data-demand-quote]').value })) });
        output.innerHTML = renderDemand(latest);
      } else {
        latest = calculateTrust([...root.querySelectorAll('[data-trust-row]')].map(row => ({ school: row.querySelector('[data-trust-school]').value, role: row.querySelector('[data-trust-role]').value, participants: row.querySelector('[data-trust-participants]').value, weeklyPlaces: row.querySelector('[data-trust-places]').value, setup: row.querySelector('[data-trust-setup]').value, weekly: row.querySelector('[data-trust-weekly]').value, phase: row.querySelector('[data-trust-phase]').value })));
        output.innerHTML = renderTrust(latest);
      }
      resultPanel.hidden = false;
      printButton.disabled = type === 'trust' && latest.rows.length === 0;
      csvButton.disabled = printButton.disabled;
      message.textContent = type === 'trust' && latest.rows.length === 0 ? 'No schools to compare. Add a school to start.' : 'Your result is ready below. Check the assumptions before printing or downloading.';
    } catch (error) {
      latest = null;
      message.textContent = error.message;
      message.classList.add('expansion-error');
      const invalid = [...form.querySelectorAll('input, select')].find(input => !input.validity.valid);
      if (invalid) invalid.focus();
    }
  });
  form.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.tagName === 'INPUT') {
      event.preventDefault();
      calculateButton.click();
    }
  });
  printButton.addEventListener('click', () => { if (latest) window.print(); });
  csvButton.addEventListener('click', () => {
    if (!latest) return;
    downloadCsv(type === 'demand' ? demandCsv(latest) : trustCsv(latest), `mml-${type === 'demand' ? 'instrument-equipment' : 'trust-rollout'}-worksheet.csv`);
    message.textContent = 'CSV downloaded. Formula-like text is prefixed with an apostrophe for spreadsheet safety.';
  });
}

document.querySelectorAll('[data-demand-tool]').forEach(root => enhance(root, 'demand'));
document.querySelectorAll('[data-trust-tool]').forEach(root => enhance(root, 'trust'));
