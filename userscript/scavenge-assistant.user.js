// ==UserScript==
// @name         Scavenge Assistant
// @namespace    local.tribal-scavenge-assistant
// @version      0.8.0
// @description  Pokročilý testovací asistent pro plánování, vyplňování a vyhodnocování sběru surovin v Divokých kmenech. Nikdy sám neodesílá příkaz.
// @author       Vladimír(UltimaX)Hrádek
// @match        https://*.tribalwars.net/game.php*
// @match        https://*.divokekmeny.cz/game.php*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'tribalScavengeAssistant.settings.v2';
    const LOG_KEY = 'tribalScavengeAssistant.log.v1';
    const DATASET_KEY = 'tribalScavengeAssistant.dataset.v1';
    const PENDING_RUNS_KEY = 'tribalScavengeAssistant.pendingRuns.v1';
    const DATA_SHARING_BUFFER_KEY = 'tribalScavengeAssistant.dataSharingBuffer.v1';
    const UI_KEY = 'tribalScavengeAssistant.ui.v1';
    const BRAND_NAME = 'Scavenge Assistant';
    const BRAND_AUTHOR = 'Created by Ultimax';
    const BRAND_YEAR = '2026';
    const LICENSE_NAME = '';
    const SCRIPT_VERSION = '0.8.0';
    const DATA_SHARING_ENDPOINT = 'https://scavenge-assistant.scavengelab.hradek-vl.workers.dev/collect';
    const DATA_SHARING_BATCH_SIZE = 10;
    const DATA_SHARING_TS_BUCKET_SECONDS = 3600;
    const TROOP_TYPES = [
        'spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher',
        'heavy', 'ram', 'catapult', 'knight', 'snob', 'militia'
    ];
    const DEFAULT_TROOP_ORDER = [
        ['spear', 'sword', 'archer'],
        ['axe'],
        ['heavy'],
        ['light', 'marcher'],
        ['knight']
    ];
    const FAST_RAIDERS = new Set(['light', 'marcher']);
    const DEFENSIVE_UNITS = new Set(['spear', 'sword', 'archer', 'heavy']);
    const THREAT_RESERVE_PERCENT = {
        calm: 0,
        normal: 0,
        elevated: 25,
        high: 50
    };
    const RESOURCE_LABELS = {
        wood: 'dřevo',
        stone: 'hlína',
        iron: 'železo'
    };
    const TROOP_LABELS = {
        spear: 'kopí',
        sword: 'meč',
        axe: 'sekera',
        archer: 'luk',
        spy: 'špeh',
        light: 'LK',
        marcher: 'jízdní luk',
        heavy: 'TK',
        ram: 'beran',
        catapult: 'katapult',
        knight: 'paladin',
        snob: 'šlechtic',
        militia: 'milice'
    };
    const PROFILE_DEFAULTS = {
        active: {
            mode: 'efficiency',
            targetMinutes: 30,
            maxMinutes: 180,
            lightPolicy: 'reserve',
            threatLevel: 'normal',
            storagePolicy: 'warn',
            reservePercent: 0
        },
        afk: {
            mode: 'target',
            targetMinutes: 180,
            maxMinutes: 480,
            lightPolicy: 'afk',
            threatLevel: 'normal',
            storagePolicy: 'warn',
            reservePercent: 0
        },
        conservative: {
            mode: 'target',
            targetMinutes: 180,
            maxMinutes: 480,
            lightPolicy: 'never',
            threatLevel: 'elevated',
            storagePolicy: 'warn',
            reservePercent: 25
        },
        night: {
            mode: 'target',
            targetMinutes: 480,
            maxMinutes: 720,
            lightPolicy: 'afk',
            threatLevel: 'normal',
            storagePolicy: 'warn',
            reservePercent: 10
        }
    };
    const DEFAULT_UI_STATE = {
        left: null,
        top: 110,
        width: 560,
        scale: 100,
        collapsed: false
    };
    const PRESETS = [
        {
            id: 'active_optimum',
            label: 'Aktivně optimum',
            patch: {
                profile: 'active',
                mode: 'efficiency',
                targetMinutes: 30,
                maxMinutes: 180,
                useTargetClock: false,
                lightPolicy: 'reserve',
                storagePolicy: 'warn',
                reservePercent: 0
            }
        },
        {
            id: 'active_2h',
            label: 'Aktivně 2h',
            patch: {
                profile: 'active',
                mode: 'target',
                targetMinutes: 120,
                maxMinutes: 120,
                useTargetClock: false,
                lightPolicy: 'reserve',
                storagePolicy: 'warn',
                reservePercent: 0
            }
        },
        {
            id: 'afk_3h',
            label: '3h AFK',
            patch: {
                profile: 'afk',
                mode: 'target',
                targetMinutes: 180,
                maxMinutes: 180,
                useTargetClock: false,
                lightPolicy: 'afk',
                storagePolicy: 'warn',
                reservePercent: 0
            }
        },
        {
            id: 'night_8h',
            label: '8h noc',
            patch: {
                profile: 'night',
                mode: 'target',
                targetMinutes: 480,
                maxMinutes: 480,
                useTargetClock: false,
                lightPolicy: 'afk',
                storagePolicy: 'warn',
                reservePercent: 10
            }
        },
        {
            id: 'no_light',
            label: 'Bez LK',
            patch: {
                lightPolicy: 'never'
            }
        }
    ];
    const DEFAULT_CARRY = {
        spear: 25,
        sword: 15,
        axe: 10,
        archer: 10,
        spy: 0,
        light: 80,
        marcher: 50,
        heavy: 50,
        ram: 0,
        catapult: 0,
        knight: 100,
        snob: 0,
        militia: 0
    };
    const DEFAULT_POP = {
        spear: 1,
        sword: 1,
        axe: 1,
        archer: 1,
        spy: 2,
        light: 4,
        marcher: 5,
        heavy: 6,
        ram: 5,
        catapult: 8,
        knight: 10,
        snob: 100,
        militia: 0
    };

    function main() {
        onReady(() => {
            try {
                const app = new ScavengeAssistant();
                app.mount();
            } catch (error) {
                console.error('[Asistent sběru surovin]', error);
            }
        });
    }

    function isScavengePage() {
        const params = new URLSearchParams(location.search);
        return params.get('screen') === 'place' && params.get('mode') === 'scavenge';
    }

    function isReportPage() {
        const params = new URLSearchParams(location.search);
        return params.get('screen') === 'report';
    }

    function isReportDetailPage() {
        const params = new URLSearchParams(location.search);
        return params.get('screen') === 'report' && params.has('view');
    }

    function onReady(callback) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', callback, { once: true });
        } else {
            callback();
        }
    }

    function emptyScavengeModels() {
        return {
            options: new Map(),
            troops: {},
            sendableTroopTypes: [],
            haulFactor: 1
        };
    }

    function emptyReportScan() {
        return {
            found: 0,
            stored: 0,
            matched: 0,
            duplicates: 0
        };
    }

    class ScavengeAssistant {
        constructor() {
            this.settings = loadSettings();
            this.models = emptyScavengeModels();
            this.plan = null;
            this.comparisons = [];
            this.$panel = null;
            this.eventsBound = false;
            this.scavengeMode = isScavengePage();
            this.reportScan = emptyReportScan();
            this.uiState = loadUiState();
            this.isApplyingUiState = false;
            this.resizeObserver = null;
            this.statusTimer = null;
            this.lastUsableSignature = '';
            this.pendingAutoFill = false;
            this.lastDatasetSnapshot = '';
            this.available = emptyCounts();
            this.usableOptionIds = [];
            this.resources = null;
            this.activeRuns = [];
            this.nextFillPreview = null;
            this.optionCount = 0;
        }

        mount() {
            injectStyles();
            this.$panel = document.createElement('section');
            this.$panel.id = 'tsa-panel';
            document.body.appendChild(this.$panel);
            this.applyUiState();
            this.render();
            this.refreshPlan();
            this.watchPageChanges();
            this.watchResize();
            this.startStatusTimer();
        }

        refreshPlan() {
            try {
                this.scavengeMode = isScavengePage();
                this.reportScan = scanActualScavengeResults(document);
                if (!this.scavengeMode) {
                    this.models = emptyScavengeModels();
                    this.plan = null;
                    this.comparisons = [];
                    this.usableOptionIds = [];
                    this.activeRuns = [];
                    this.nextFillPreview = null;
                    this.optionCount = 0;
                    this.updateHeaderStatus();
                    this.renderGlobal();
                    return;
                }
                this.models = scrapeScavengeModels(document);
                const available = scrapeAvailableTroopCounts(document);
                const usableOptionIds = scrapeUsableOptionIds(document);
                const resources = scrapeResourceState(document);
                const activeRuns = scrapeActiveScavengeRuns(document);
                this.available = available;
                this.usableOptionIds = usableOptionIds;
                this.resources = resources;
                this.activeRuns = activeRuns;
                this.optionCount = countScavengeOptions(document, this.models);
                this.plan = buildPlan({
                    models: this.models,
                    settings: this.settings,
                    available,
                    usableOptionIds,
                    resources
                });
                this.comparisons = buildPlanComparisons({
                    models: this.models,
                    settings: this.settings,
                    available,
                    usableOptionIds,
                    resources
                });
                this.nextFillPreview = buildNextFillPreview({
                    models: this.models,
                    settings: this.settings,
                    available,
                    usableOptionIds,
                    resources,
                    activeRuns
                });
                if (!this.$panel.querySelector('.tsa-result')) {
                    this.render();
                }
                this.updateHeaderStatus();
                this.renderPlan();
                this.renderComparison();
                this.renderRecommendation();
                this.recordReadyDatasetSnapshot('refresh', usableOptionIds, available);
            } catch (error) {
                this.renderError(error);
            }
        }

        render() {
            this.scavengeMode = isScavengePage();
            if (!this.scavengeMode) {
                this.renderGlobal();
                return;
            }
            const miniStatus = this.miniStatusText();
            this.$panel.classList.toggle('tsa-collapsed', this.uiState.collapsed);
            this.$panel.innerHTML = `
                <div class="tsa-head">
                    <strong class="tsa-drag-handle" data-drag-handle="true" title="Přetáhni panel myší">
                        <span class="tsa-title-main">${BRAND_NAME}</span>
                        <span class="tsa-title-status">${escapeHtml(miniStatus)}</span>
                    </strong>
                    <div class="tsa-head-actions">
                        <button type="button" data-action="ui-smaller" title="Zmenšit UI">-</button>
                        <button type="button" data-action="ui-larger" title="Zvětšit UI">+</button>
                        <button type="button" data-action="ui-reset" title="Vrátit panel do rohu">↺</button>
                        <button type="button" data-action="ui-collapse">${this.uiState.collapsed ? 'Rozbalit' : 'Sbalit'}</button>
                        <button type="button" data-action="refresh">Obnovit</button>
                    </div>
                </div>
                <div class="tsa-body">
                <label class="tsa-row">
                    <span>Profil</span>
                    <select data-setting="profile">
                        <option value="active">Aktivně max/h</option>
                        <option value="afk">AFK návrat</option>
                        <option value="conservative">Opatrně</option>
                        <option value="night">Noc</option>
                    </select>
                </label>
                <label class="tsa-row">
                    <span>Strategie</span>
                    <select data-setting="mode">
                        <option value="efficiency">Nejvíc surovin/h</option>
                        <option value="balanced">Stejný výnos/čas</option>
                        <option value="target">Nejlepší možnosti první</option>
                    </select>
                </label>
                <label class="tsa-row">
                    <span>Cíl</span>
                    <input type="number" min="30" step="15" data-setting="targetMinutes"> min
                </label>
                <label class="tsa-row">
                    <span>Návrat</span>
                    <input type="checkbox" data-setting="useTargetClock">
                    <input type="time" data-setting="targetClock">
                </label>
                <label class="tsa-row">
                    <span>Do</span>
                    <input type="number" min="30" step="15" data-setting="maxMinutes"> min
                </label>
                <label class="tsa-row">
                    <span>Rezerva</span>
                    <input type="range" min="0" max="90" step="5" data-setting="reservePercent">
                    <output class="tsa-reserve-output"></output>
                </label>
                <label class="tsa-row">
                    <span>Jízda</span>
                    <select data-setting="lightPolicy">
                        <option value="never">Nikdy LK/jízdní luk</option>
                        <option value="reserve">Jen nad rezervu</option>
                        <option value="afk">Jen AFK/noc</option>
                        <option value="always">Vždy povolit</option>
                    </select>
                </label>
                <label class="tsa-row">
                    <span>Hrozba</span>
                    <select data-setting="threatLevel">
                        <option value="calm">Klid</option>
                        <option value="normal">Normál</option>
                        <option value="elevated">Zvýšená</option>
                        <option value="high">Vysoká</option>
                    </select>
                </label>
                <label class="tsa-row">
                    <span>Sklad</span>
                    <select data-setting="storagePolicy">
                        <option value="warn">Jen upozornit</option>
                        <option value="cap">Omezit výnos</option>
                        <option value="ignore">Ignorovat</option>
                    </select>
                </label>
                <label class="tsa-row">
                    <span>Horizont</span>
                    <input type="number" min="1" max="72" step="1" data-setting="horizonHours"> h
                </label>
                <label class="tsa-row tsa-checkbox-row">
                    <span>Auto</span>
                    <label><input type="checkbox" data-setting="autoFillNext"> po ručním odeslání vyplnit další</label>
                </label>
                <label class="tsa-row tsa-checkbox-row">
                    <span>Data</span>
                    <label><input type="checkbox" data-setting="dataSharing"> sdílet anonymní data pro zlepšení asistenta</label>
                </label>
                <div class="tsa-note tsa-privacy-note">
                    Tento asistent může (volitelně) odesílat anonymní herní data pro zlepšení výpočtů.
                    Neodesílají se žádné osobní údaje.
                </div>
                <div class="tsa-presets">
                    ${PRESETS.map(preset => `<button type="button" data-action="preset" data-preset-id="${preset.id}">${preset.label}</button>`).join('')}
                </div>
                <div class="tsa-recommendation"></div>
                <details>
                    <summary>Možnosti sběru</summary>
                    <div class="tsa-options"></div>
                </details>
                <details>
                    <summary>Jednotky a rezervy</summary>
                    <div class="tsa-troops"></div>
                </details>
                <details open>
                    <summary>Porovnání plánů</summary>
                    <div class="tsa-comparison"></div>
                </details>
                <details>
                    <summary>Lokální záznam</summary>
                    <div class="tsa-log"></div>
                </details>
                <details>
                    <summary>Historie / dataset</summary>
                    <div class="tsa-dataset"></div>
                </details>
                <div class="tsa-actions">
                    <button type="button" data-action="fill-next">Vyplnit další</button>
                    <button type="button" data-action="log-plan">Zapsat plán</button>
                    <button type="button" data-action="reset">Reset nastavení</button>
                </div>
                <div class="tsa-result"></div>
                ${this.brandFooterHtml()}
                </div>
            `;

            this.$panel.querySelector('[data-setting="profile"]').value = this.settings.profile;
            this.$panel.querySelector('[data-setting="mode"]').value = this.settings.mode;
            this.$panel.querySelector('[data-setting="targetMinutes"]').value = this.settings.targetMinutes;
            this.$panel.querySelector('[data-setting="useTargetClock"]').checked = this.settings.useTargetClock;
            this.$panel.querySelector('[data-setting="targetClock"]').value = this.settings.targetClock;
            this.$panel.querySelector('[data-setting="maxMinutes"]').value = this.settings.maxMinutes;
            this.$panel.querySelector('[data-setting="reservePercent"]').value = this.settings.reservePercent;
            this.$panel.querySelector('[data-setting="lightPolicy"]').value = this.settings.lightPolicy;
            this.$panel.querySelector('[data-setting="threatLevel"]').value = this.settings.threatLevel;
            this.$panel.querySelector('[data-setting="storagePolicy"]').value = this.settings.storagePolicy;
            this.$panel.querySelector('[data-setting="horizonHours"]').value = this.settings.horizonHours;
            this.$panel.querySelector('[data-setting="autoFillNext"]').checked = this.settings.autoFillNext;
            this.$panel.querySelector('[data-setting="dataSharing"]').checked = !!(this.settings.dataSharing && this.settings.dataSharing.enabled);
            this.updateReserveOutput();
            this.renderOptionSettings();
            this.renderTroopSettings();
            this.renderLog();
            this.renderDataset();
            this.updateHeaderStatus();
            if (!this.eventsBound) {
                this.bindEvents();
                this.eventsBound = true;
            }
        }

        renderGlobal() {
            if (!this.$panel) {
                return;
            }
            const miniStatus = this.miniStatusText();
            this.$panel.classList.toggle('tsa-collapsed', this.uiState.collapsed);
            this.$panel.innerHTML = `
                <div class="tsa-head">
                    <strong class="tsa-drag-handle" data-drag-handle="true" title="Přetáhni panel myší">
                        <span class="tsa-title-main">${BRAND_NAME}</span>
                        <span class="tsa-title-status">${escapeHtml(miniStatus)}</span>
                    </strong>
                    <div class="tsa-head-actions">
                        <button type="button" data-action="ui-smaller" title="Zmenšit UI">-</button>
                        <button type="button" data-action="ui-larger" title="Zvětšit UI">+</button>
                        <button type="button" data-action="ui-reset" title="Vrátit panel do rohu">↻</button>
                        <button type="button" data-action="ui-collapse">${this.uiState.collapsed ? 'Rozbalit' : 'Sbalit'}</button>
                        <button type="button" data-action="refresh">Obnovit</button>
                    </div>
                </div>
                <div class="tsa-body">
                    <div class="tsa-note">${this.globalStatusHtml()}</div>
                    <details open>
                        <summary>Čtení oznámení</summary>
                        <div class="tsa-report-scan">${this.reportScanHtml()}</div>
                    </details>
                    <details>
                        <summary>Lokální záznam</summary>
                        <div class="tsa-log"></div>
                    </details>
                    <details open>
                        <summary>Historie / dataset</summary>
                        <div class="tsa-dataset"></div>
                    </details>
                    ${this.brandFooterHtml()}
                </div>
            `;
            this.renderLog();
            this.renderDataset();
            this.updateHeaderStatus();
            if (!this.eventsBound) {
                this.bindEvents();
                this.eventsBound = true;
            }
        }

        globalStatusHtml() {
            const params = new URLSearchParams(location.search);
            const screen = params.get('screen') || 'stránka';
            if (isReportPage()) {
                return 'Globální režim: čtu oznámení a páruji výsledky sběru s uloženým datasetem. Plánování jednotek se zapne na stránce Sběr surovin.';
            }
            return `Globální režim běží na obrazovce ${escapeHtml(screen)}. Přejdi na Sběr surovin pro plánování, nebo otevři oznámení pro načtení skutečných výsledků.`;
        }

        brandFooterHtml() {
            return `
                <div class="tsa-brand">
                    ${BRAND_NAME} v${SCRIPT_VERSION}<br>
                    © ${BRAND_YEAR} ${escapeHtml(BRAND_AUTHOR)} · ${LICENSE_NAME}
                </div>
            `;
        }

        reportScanHtml() {
            const scan = this.reportScan || emptyReportScan();
            const pending = loadPendingRuns().filter(run => !run.matched && run.world === location.hostname);
            const lastMatched = latestDatasetEntry(entry => entry.type === 'actual_result' && entry.matched);
            const lastActual = latestDatasetEntry(entry => entry.type === 'actual_result');
            const lastLine = lastActual
                ? `Poslední výsledek: ${formatNumber(Math.round(lastActual.actualTotal || 0))}${lastActual.matched ? `, rozdíl ${formatSignedNumber(lastActual.delta || 0)}` : ', bez párování'}.`
                : 'Zatím není uložený žádný skutečný výsledek ze sběru.';
            const matchedLine = lastMatched
                ? `Poslední spárovaný běh: ${escapeHtml(lastMatched.time || '')}.`
                : 'Žádný výsledek zatím nebyl spárovaný s plánem.';

            return `
                <div class="tsa-note">
                    Na této stránce nalezeno výsledků: ${scan.found},
                    nově uloženo: ${scan.stored},
                    spárováno: ${scan.matched}.
                    Čekající běhy: ${pending.length}.
                </div>
                <div class="tsa-note">${lastLine} ${matchedLine}</div>
            `;
        }

        renderOptionSettings() {
            const optionBox = this.$panel.querySelector('.tsa-options');
            const options = [...this.models.options.values()].sort((a, b) => a.id - b.id);
            optionBox.innerHTML = options.map(option => {
                const allowed = this.settings.allowedOptions[option.id] !== false;
                return `
                    <label class="tsa-option">
                        <input type="checkbox" data-option-allowed="${option.id}" ${allowed ? 'checked' : ''}>
                        <span>${option.id}. ${escapeHtml(option.name || `Možnost ${option.id}`)}</span>
                        <em>${Math.round(option.loot_factor * 100)}%</em>
                    </label>
                `;
            }).join('');
        }

        renderTroopSettings() {
            const troopBox = this.$panel.querySelector('.tsa-troops');
            const sendable = this.models.sendableTroopTypes.length
                ? this.models.sendableTroopTypes
                : TROOP_TYPES.filter(type => getTroopCarry(this.models.troops, type) > 0);

            troopBox.innerHTML = sendable.map(type => {
                const allowed = this.settings.allowedTroops[type] !== false;
                const reserve = this.settings.reserves[type] || 0;
                return `
                    <label class="tsa-troop">
                        <input type="checkbox" data-troop-allowed="${type}" ${allowed ? 'checked' : ''}>
                        <span>${escapeHtml(troopLabel(type))}</span>
                        <input type="number" min="0" step="1" data-troop-reserve="${type}" value="${reserve}">
                    </label>
                `;
            }).join('');
        }

        bindEvents() {
            this.$panel.addEventListener('input', event => {
                const target = event.target;
                if (target.matches('[data-setting="reservePercent"]')) {
                    this.settings.reservePercent = clampInt(target.value, 0, 90);
                    this.updateReserveOutput();
                    saveSettings(this.settings);
                    this.refreshPlan();
                }
            });

            this.$panel.addEventListener('change', event => {
                const target = event.target;
                if (target.matches('[data-setting="profile"]')) {
                    this.settings.profile = target.value;
                    applyProfileDefaults(this.settings, this.settings.profile);
                    saveSettings(this.settings);
                    this.render();
                    this.refreshPlan();
                    return;
                }
                if (target.matches('[data-setting="mode"]')) {
                    this.settings.mode = target.value;
                }
                if (target.matches('[data-setting="targetMinutes"]')) {
                    this.settings.targetMinutes = clampInt(target.value, 30, 24 * 60);
                }
                if (target.matches('[data-setting="useTargetClock"]')) {
                    this.settings.useTargetClock = target.checked;
                }
                if (target.matches('[data-setting="targetClock"]')) {
                    this.settings.targetClock = target.value || '21:00';
                }
                if (target.matches('[data-setting="maxMinutes"]')) {
                    this.settings.maxMinutes = clampInt(target.value, 30, 48 * 60);
                }
                if (target.matches('[data-setting="reservePercent"]')) {
                    this.settings.reservePercent = clampInt(target.value, 0, 90);
                    this.updateReserveOutput();
                }
                if (target.matches('[data-setting="lightPolicy"]')) {
                    this.settings.lightPolicy = target.value;
                }
                if (target.matches('[data-setting="threatLevel"]')) {
                    this.settings.threatLevel = target.value;
                }
                if (target.matches('[data-setting="storagePolicy"]')) {
                    this.settings.storagePolicy = target.value;
                }
                if (target.matches('[data-setting="horizonHours"]')) {
                    this.settings.horizonHours = clampInt(target.value, 1, 72);
                }
                if (target.matches('[data-setting="autoFillNext"]')) {
                    this.settings.autoFillNext = target.checked;
                }
                if (target.matches('[data-setting="dataSharing"]')) {
                    this.settings.dataSharing.enabled = target.checked;
                    this.settings.dataSharing.consentGiven = target.checked;
                }
                if (target.matches('[data-troop-allowed]')) {
                    this.settings.allowedTroops[target.dataset.troopAllowed] = target.checked;
                }
                if (target.matches('[data-option-allowed]')) {
                    this.settings.allowedOptions[target.dataset.optionAllowed] = target.checked;
                }
                if (target.matches('[data-troop-reserve]')) {
                    this.settings.reserves[target.dataset.troopReserve] = clampInt(target.value, 0, 999999);
                }
                saveSettings(this.settings);
                this.refreshPlan();
            });

            this.$panel.addEventListener('click', event => {
                const action = event.target.dataset.action;
                if (!action) {
                    return;
                }
                if (action === 'refresh') {
                    this.refreshPlan();
                }
                if (action === 'preset') {
                    this.applyPreset(event.target.dataset.presetId);
                }
                if (action === 'ui-collapse') {
                    this.uiState.collapsed = !this.uiState.collapsed;
                    saveUiState(this.uiState);
                    this.applyUiState();
                    this.render();
                    if (!this.uiState.collapsed) {
                        this.refreshPlan();
                    }
                }
                if (action === 'ui-smaller') {
                    this.setUiScale(this.uiState.scale - 10);
                }
                if (action === 'ui-larger') {
                    this.setUiScale(this.uiState.scale + 10);
                }
                if (action === 'ui-reset') {
                    this.uiState = defaultUiState();
                    saveUiState(this.uiState);
                    this.applyUiState();
                    this.render();
                    this.refreshPlan();
                }
                if (action === 'fill-next') {
                    this.fillNext();
                }
                if (action === 'reset') {
                    this.settings = defaultSettings();
                    saveSettings(this.settings);
                    this.render();
                    this.refreshPlan();
                }
                if (action === 'log-plan') {
                    this.logPlan('manual');
                }
                if (action === 'clear-log') {
                    saveLog([]);
                    this.renderLog();
                }
                if (action === 'clear-dataset') {
                    if (!window.confirm('Opravdu vymazat dataset asistenta v tomto prohlížeči?')) {
                        return;
                    }
                    saveDataset([]);
                    savePendingRuns([]);
                    saveDataSharingBuffer([]);
                    this.renderDataset();
                }
                if (action === 'export-dataset') {
                    this.exportDataset();
                }
                if (action === 'send-sharing-buffer') {
                    flushDataSharingBuffer(this.settings, true).then(() => this.renderDataset());
                }
                if (action === 'fill-option') {
                    this.fillOption(parseInt(event.target.dataset.optionId, 10));
                }
            });

            this.$panel.addEventListener('pointerdown', event => {
                const handle = event.target.closest('[data-drag-handle]');
                if (!handle || event.button !== 0) {
                    return;
                }
                this.startDrag(event);
            });
        }

        applyPreset(presetId) {
            const preset = PRESETS.find(item => item.id === presetId);
            if (!preset) {
                return;
            }
            this.settings = normalizeSettings({
                ...this.settings,
                allowedOptions: { ...this.settings.allowedOptions },
                allowedTroops: { ...this.settings.allowedTroops },
                reserves: { ...this.settings.reserves },
                ...preset.patch
            });
            saveSettings(this.settings);
            this.render();
            this.refreshPlan();
        }

        setUiScale(scale) {
            this.uiState.scale = clampInt(scale, 80, 130);
            saveUiState(this.uiState);
            this.applyUiState();
        }

        startDrag(event) {
            const rect = this.$panel.getBoundingClientRect();
            const startX = event.clientX;
            const startY = event.clientY;
            const startLeft = rect.left;
            const startTop = rect.top;

            const move = moveEvent => {
                const width = this.$panel.offsetWidth;
                const height = this.$panel.offsetHeight;
                const left = clampNumber(startLeft + moveEvent.clientX - startX, 0, window.innerWidth - Math.min(120, width));
                const top = clampNumber(startTop + moveEvent.clientY - startY, 0, window.innerHeight - Math.min(40, height));
                this.uiState.left = Math.round(left);
                this.uiState.top = Math.round(top);
                this.applyUiState(false);
            };

            const up = () => {
                document.removeEventListener('pointermove', move);
                document.removeEventListener('pointerup', up);
                saveUiState(this.uiState);
            };

            event.preventDefault();
            document.addEventListener('pointermove', move);
            document.addEventListener('pointerup', up, { once: true });
        }

        applyUiState(persist = true) {
            if (!this.$panel) {
                return;
            }

            this.isApplyingUiState = true;
            this.uiState = normalizeUiState(this.uiState);
            this.$panel.classList.toggle('tsa-collapsed', this.uiState.collapsed);
            this.$panel.style.left = `${this.uiState.left}px`;
            this.$panel.style.top = `${this.uiState.top}px`;
            this.$panel.style.right = 'auto';
            this.$panel.style.width = `${this.uiState.width}px`;
            this.$panel.style.setProperty('--tsa-scale', String(this.uiState.scale / 100));
            this.isApplyingUiState = false;

            if (persist) {
                saveUiState(this.uiState);
            }
        }

        watchResize() {
            if (!window.ResizeObserver || !this.$panel) {
                return;
            }
            this.resizeObserver = new ResizeObserver(() => {
                if (this.isApplyingUiState || this.uiState.collapsed) {
                    return;
                }
                const width = Math.round(this.$panel.getBoundingClientRect().width);
                if (Math.abs(width - this.uiState.width) < 4) {
                    return;
                }
                this.uiState.width = clampInt(width, 330, Math.max(360, window.innerWidth - 16));
                saveUiState(this.uiState);
            });
            this.resizeObserver.observe(this.$panel);
        }

        startStatusTimer() {
            if (this.statusTimer) {
                return;
            }
            this.statusTimer = window.setInterval(() => {
                this.updateHeaderStatus();
                this.updateActiveRunTimers();
            }, 10000);
        }

        miniStatusText() {
            const parts = [];
            if (!this.scavengeMode) {
                const pending = loadPendingRuns().filter(run => !run.matched && run.world === location.hostname).length;
                parts.push(isReportPage() ? 'čtu oznámení' : 'globální režim');
                if (this.reportScan && this.reportScan.stored) {
                    parts.push(`uloženo ${this.reportScan.stored}`);
                }
                if (this.reportScan && this.reportScan.matched) {
                    parts.push(`spárováno ${this.reportScan.matched}`);
                }
                if (pending) {
                    parts.push(`čeká ${pending}`);
                }
                return parts.join(' | ');
            }
            const activeCount = this.activeRuns.length;
            const total = this.optionCount || (this.models && this.models.options ? this.models.options.size : 0);
            const nextRun = nextActiveRun(this.activeRuns);

            if (total && activeCount) {
                parts.push(`${activeCount}/${total} běží`);
            } else if (this.usableOptionIds.length) {
                parts.push(`${this.usableOptionIds.length} volné`);
            }

            if (nextRun) {
                parts.push(`další ${formatShortRemaining(currentRemainingSeconds(nextRun))}`);
            }

            parts.push(this.settings.autoFillNext ? 'auto ON' : 'auto OFF');
            return parts.join(' | ');
        }

        updateHeaderStatus() {
            if (!this.$panel) {
                return;
            }
            const status = this.$panel.querySelector('.tsa-title-status');
            if (status) {
                status.textContent = this.miniStatusText();
            }
        }

        updateActiveRunTimers() {
            if (!this.$panel || !this.activeRuns.length) {
                return;
            }
            const nextRun = nextActiveRun(this.activeRuns);
            this.$panel.querySelectorAll('[data-active-run-remaining]').forEach(element => {
                const optionId = parseInt(element.dataset.activeRunRemaining, 10);
                const run = this.activeRuns.find(item => item.optionId === optionId);
                if (run) {
                    element.textContent = formatRemainingTime(currentRemainingSeconds(run));
                }
            });
            this.$panel.querySelectorAll('[data-next-run-remaining]').forEach(element => {
                element.textContent = nextRun
                    ? formatRemainingTime(currentRemainingSeconds(nextRun))
                    : '-';
            });
        }

        updateReserveOutput() {
            const output = this.$panel.querySelector('.tsa-reserve-output');
            if (output) {
                output.textContent = `${this.settings.reservePercent}%`;
            }
        }

        renderPlan() {
            const box = this.$panel.querySelector('.tsa-result');
            if (!this.plan || !this.plan.rows.length) {
                box.innerHTML = this.emptyPlanHtml();
                this.updateActiveRunTimers();
                return;
            }

            const rowsHtml = this.plan.rows.map(row => `
                <tr>
                    <td>${row.optionId}</td>
                    <td>${formatDuration(row.durationSeconds)}</td>
                    <td>${formatNumber(Math.round(row.lootTotal))}</td>
                    <td>${formatNumber(Math.round(row.lootPerHour))}</td>
                    <td>${formatTroopCounts(row.troops)}</td>
                    <td><button type="button" data-action="fill-option" data-option-id="${row.optionId}">Vyplnit</button></td>
                </tr>
            `).join('');

            box.innerHTML = `
                <div class="tsa-note">
                    ${this.plan.modeLabel}. Dostupná nosnost: ${formatNumber(Math.round(this.plan.availableCapacity))}.
                    Plán celkem: ${formatNumber(Math.round(this.plan.totalLoot))}
                    (~${formatNumber(Math.round(this.plan.totalLoot / 3))} od každé).
                    ${this.plan.estimatedWaste > 0 ? `Riziko přetečení: ~${formatNumber(Math.round(this.plan.estimatedWaste))}. ` : ''}
                    Efektivní výnos/h: ${formatNumber(Math.round(this.plan.effectiveLootPerHour))}.
                    Odhad za ${this.plan.settings.horizonHours} h: ${formatNumber(Math.round(this.plan.horizonLoot))}
                    (${formatDecimal(this.plan.runsPerHorizon, 1)} běhů).
                    Délka návratu: ${formatDuration(this.plan.maxDurationSeconds)}.
                    ${formatStorageSummary(this.plan.resources)}
                </div>
                ${this.activeRuns.length ? this.activeRunsHtml('Běžící sběry') : ''}
                <table>
                    <thead>
                        <tr>
                            <th>Mož.</th>
                            <th>Čas</th>
                            <th>Výnos</th>
                            <th>/h</th>
                            <th>Jednotky</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            `;
            this.updateActiveRunTimers();
        }

        emptyPlanHtml() {
            const total = this.optionCount || (this.models && this.models.options ? this.models.options.size : 0);
            const activeCount = this.activeRuns.length;
            const allRunning = total > 0 && activeCount >= total && !this.usableOptionIds.length;
            let message = 'Není dostupná žádná použitelná možnost sběru.';

            if (allRunning) {
                message = 'Všechny sběry běží.';
            } else if (!this.usableOptionIds.length && activeCount) {
                message = 'Momentálně není volná žádná použitelná možnost sběru.';
            } else if (this.plan && this.plan.availableCapacity <= 0) {
                message = 'Nejsou volné žádné použitelné jednotky podle aktuálních rezerv a filtrů.';
            } else if (this.usableOptionIds.length && !this.usableOptionIds.some(optionId => this.settings.allowedOptions[optionId] !== false)) {
                message = 'Volné možnosti sběru jsou vypnuté v nastavení asistenta.';
            }

            const nextRun = nextActiveRun(this.activeRuns);
            const nextText = nextRun
                ? ` Další návrat za <span data-next-run-remaining>${formatRemainingTime(currentRemainingSeconds(nextRun))}</span>.`
                : '';

            return `
                <div class="tsa-note">${message}${nextText}</div>
                ${this.activeRuns.length ? this.activeRunsHtml('Aktivní sběry') : ''}
                ${this.nextFillPreviewHtml()}
            `;
        }

        activeRunsHtml(title) {
            const rows = [...this.activeRuns]
                .sort((a, b) => a.optionId - b.optionId)
                .map(run => {
                    const option = this.models.options.get(run.optionId) || {};
                    const name = run.name || option.name || `Možnost ${run.optionId}`;
                    return `
                        <tr>
                            <td>${run.optionId}</td>
                            <td>${escapeHtml(name)}</td>
                            <td><span data-active-run-remaining="${run.optionId}">${formatRemainingTime(currentRemainingSeconds(run))}</span></td>
                            <td>${run.expectedTotal ? formatNumber(Math.round(run.expectedTotal)) : '-'}</td>
                        </tr>
                    `;
                }).join('');

            return `
                <div class="tsa-active-runs">
                    <strong>${escapeHtml(title)}</strong>
                    <table>
                        <thead>
                            <tr>
                                <th>Mož.</th>
                                <th>Sběr</th>
                                <th>Návrat</th>
                                <th>Oček.</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            `;
        }

        nextFillPreviewHtml() {
            const preview = this.nextFillPreview;
            if (!preview) {
                return '';
            }

            if (!preview.row) {
                return `
                    <div class="tsa-next-preview">
                        <strong>Po nejbližším návratu:</strong>
                        ${escapeHtml(preview.reason)}
                    </div>
                `;
            }

            return `
                <div class="tsa-next-preview">
                    <strong>Po nejbližším návratu:</strong>
                    vyplnit možnost ${preview.row.optionId}, odhad ${formatDuration(preview.row.durationSeconds)},
                    výnos ${formatNumber(Math.round(preview.row.lootTotal))}, jednotky ${formatTroopCounts(preview.row.troops)}.
                    ${preview.usesReturningTroops ? '' : '<span>Bez známých vracejících jednotek počítám jen s tím, co je teď doma.</span>'}
                </div>
            `;
        }

        renderComparison() {
            const box = this.$panel.querySelector('.tsa-comparison');
            if (!box || !this.comparisons || !this.comparisons.length) {
                return;
            }
            if (this.activeRuns.length && !this.comparisons.some(item => item.maxDurationSeconds > 0)) {
                box.innerHTML = '<div class="tsa-note">Porovnání bude smysluplné, jakmile se uvolní alespoň jedna možnost sběru.</div>';
                return;
            }

            const rows = this.comparisons.map(item => `
                <tr class="${item.isCurrent ? 'is-current' : ''}">
                    <td>${escapeHtml(item.label)}</td>
                    <td>${formatDuration(item.maxDurationSeconds)}</td>
                    <td>${formatNumber(Math.round(item.totalLoot))}</td>
                    <td>${formatNumber(Math.round(item.lootPerHour))}</td>
                    <td>${item.estimatedWaste > 0 ? formatNumber(Math.round(item.estimatedWaste)) : '-'}</td>
                    <td>${formatDecimal(item.runsPerHorizon, 1)}</td>
                    <td>${formatNumber(Math.round(item.horizonLoot))}</td>
                </tr>
            `).join('');

            box.innerHTML = `
                <table>
                    <thead>
                        <tr>
                            <th>Plán</th>
                            <th>Čas</th>
                            <th>Výnos</th>
                            <th>/h</th>
                            <th>Ztr.</th>
                            <th>Běhy</th>
                            <th>${this.plan ? this.plan.settings.horizonHours : this.settings.horizonHours}h</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            `;
        }

        renderRecommendation() {
            const box = this.$panel.querySelector('.tsa-recommendation');
            if (!box || !this.comparisons || !this.comparisons.length) {
                return;
            }
            const recommendation = recommendPlan(this.comparisons);
            if (!recommendation) {
                box.innerHTML = '';
                return;
            }
            box.innerHTML = `
                <div class="tsa-recommendation-box">
                    <strong>Doporučený plán:</strong>
                    ${escapeHtml(recommendation.label)}
                    <span>${escapeHtml(recommendation.reason)}</span>
                </div>
            `;
        }

        renderLog() {
            const box = this.$panel && this.$panel.querySelector('.tsa-log');
            if (!box) {
                return;
            }
            const log = loadLog();
            const rows = log.slice(-8).reverse().map(entry => `
                <tr>
                    <td>${escapeHtml(entry.time)}</td>
                    <td>${escapeHtml(entry.profile)}</td>
                    <td>${formatDuration(entry.durationSeconds)}</td>
                    <td>${formatNumber(Math.round(entry.totalLoot))}</td>
                    <td>${formatNumber(Math.round(entry.lootPerHour))}</td>
                </tr>
            `).join('');

            box.innerHTML = `
                <div class="tsa-actions">
                    <button type="button" data-action="clear-log">Vymazat záznam</button>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>Čas</th>
                            <th>Profil</th>
                            <th>Běh</th>
                            <th>Výnos</th>
                            <th>/h</th>
                        </tr>
                    </thead>
                    <tbody>${rows || '<tr><td colspan="5">Zatím tu není žádný lokální záznam.</td></tr>'}</tbody>
                </table>
            `;
        }

        renderDataset() {
            const box = this.$panel && this.$panel.querySelector('.tsa-dataset');
            if (!box) {
                return;
            }
            const dataset = loadDataset();
            const summary = summarizeDataset(dataset);
            const latest = dataset.slice(-6).reverse().map(entry => `
                <tr>
                    <td>${escapeHtml(entry.time || '')}</td>
                    <td>${escapeHtml(entry.type || '')}</td>
                    <td>${escapeHtml(entry.villageId || '-')}</td>
                    <td>${entry.expectedTotal || entry.actualTotal ? formatNumber(Math.round(entry.expectedTotal || entry.actualTotal)) : '-'}</td>
                </tr>
            `).join('');

            box.innerHTML = `
                <div class="tsa-actions">
                    <button type="button" data-action="export-dataset">Export JSON</button>
                    <button type="button" data-action="send-sharing-buffer">Odeslat anonymní buffer</button>
                    <button type="button" data-action="clear-dataset">Vymazat dataset</button>
                </div>
                ${this.datasetSummaryHtml(summary)}
                <div class="tsa-note">Záznamů: ${dataset.length}. Buffer anonymního sdílení: ${loadDataSharingBuffer().length}. Ukládá plán, jednotky, nastavení, aktivní návraty a snapshot viditelných karet pro pozdější analýzu.</div>
                <table>
                    <thead>
                        <tr>
                            <th>Čas</th>
                            <th>Typ</th>
                            <th>Vesnice</th>
                            <th>Výnos</th>
                        </tr>
                    </thead>
                    <tbody>${latest || '<tr><td colspan="4">Dataset je zatím prázdný.</td></tr>'}</tbody>
                </table>
            `;
        }

        datasetSummaryHtml(summary) {
            const accuracy = summary.accuracy;
            const accuracyText = accuracy.count
                ? `Vzorků: ${accuracy.count}, průměrná odchylka ${formatSignedPercent(accuracy.avgPct)}, absolutně ${formatPercent(accuracy.avgAbsPct)}, součet realita/plán ${formatPercent(accuracy.totalRatioPct)}.`
                : 'Zatím není dost spárovaných výsledků pro výpočet přesnosti.';
            const latestRows = accuracy.latest.map(item => `
                <tr>
                    <td>${escapeHtml(shortTime(item.time))}</td>
                    <td>${formatNumber(Math.round(item.expected))}</td>
                    <td>${formatNumber(Math.round(item.actual))}</td>
                    <td>${formatSignedPercent(item.deltaPct)}</td>
                </tr>
            `).join('');

            return `
                <div class="tsa-dataset-summary">
                    <div class="tsa-metrics">
                        <div><strong>${formatNumber(summary.total)}</strong><span>záznamů</span></div>
                        <div><strong>${formatNumber(summary.planned)}</strong><span>plánů</span></div>
                        <div><strong>${formatNumber(summary.actual)}</strong><span>výsledků</span></div>
                        <div><strong>${formatNumber(summary.matched)}</strong><span>spárováno</span></div>
                    </div>
                    <div class="tsa-note"><strong>Přesnost predikce:</strong> ${accuracyText}</div>
                    ${latestRows ? `
                        <table>
                            <thead>
                                <tr>
                                    <th>Čas</th>
                                    <th>Plán</th>
                                    <th>Realita</th>
                                    <th>Odch.</th>
                                </tr>
                            </thead>
                            <tbody>${latestRows}</tbody>
                        </table>
                    ` : ''}
                </div>
            `;
        }

        exportDataset() {
            const dataset = loadDataset();
            const payload = JSON.stringify(dataset, null, 2);
            const textarea = document.createElement('textarea');
            textarea.value = payload;
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            textarea.remove();
            window.UI && window.UI.SuccessMessage
                ? window.UI.SuccessMessage('Dataset zkopírován do schránky.')
                : alert('Dataset zkopírován do schránky.');
        }

        logPlan(reason, filledOptionId = null) {
            if (!this.plan || !this.plan.rows.length) {
                return;
            }
            const datasetEntry = createDatasetEntry(reason, this.plan, this.settings, filledOptionId);
            const log = loadLog();
            log.push({
                time: datasetEntry.time,
                reason,
                profile: `${profileLabel(this.settings.profile)}/${strategyLabel(this.settings.mode)}`,
                optionId: datasetEntry.optionId,
                durationSeconds: datasetEntry.durationSeconds,
                totalLoot: datasetEntry.expectedTotal,
                effectiveLoot: datasetEntry.effectiveLoot,
                estimatedWaste: datasetEntry.estimatedWaste,
                lootPerHour: datasetEntry.effectiveLootPerHour,
                rows: datasetEntry.rows
            });
            saveLog(log.slice(-50));
            appendDatasetEntry(datasetEntry);
            if (reason.startsWith('fill-')) {
                appendPendingRun(datasetEntry);
            }
            this.renderLog();
            this.renderDataset();
        }

        renderError(error) {
            this.$panel.querySelector('.tsa-result').innerHTML = `
                <div class="tsa-error">${escapeHtml(error.message || String(error))}</div>
            `;
        }

        fillNext() {
            if (!this.plan) {
                return;
            }
            const row = this.plan.rows.find(item => troopSum(item.troops) > 0);
            if (row) {
                this.fillOption(row.optionId);
            }
        }

        fillOption(optionId) {
            const row = this.plan && this.plan.rows.find(item => item.optionId === optionId);
            if (!row) {
                return;
            }
            fillTroopInputs(row.troops);
            focusStartButton(optionId);
            this.logPlan(`fill-${optionId}`, optionId);
        }

        watchPageChanges() {
            const root = document.querySelector('#content_value');
            if (!root) {
                return;
            }
            let timer = null;
            this.lastUsableSignature = isScavengePage() ? usableOptionsSignature() : '';
            const observer = new MutationObserver(mutations => {
                if (this.$panel && mutations.every(mutation => this.$panel.contains(mutation.target))) {
                    return;
                }
                clearTimeout(timer);
                timer = setTimeout(() => {
                    if (!isScavengePage()) {
                        this.refreshPlan();
                        return;
                    }
                    const before = this.lastUsableSignature;
                    const after = usableOptionsSignature();
                    const changed = before && after !== before;
                    this.lastUsableSignature = after;
                    this.refreshPlan();
                    if (changed && this.settings.autoFillNext && !this.pendingAutoFill) {
                        this.pendingAutoFill = true;
                        setTimeout(() => {
                            this.pendingAutoFill = false;
                            this.refreshPlan();
                            this.fillNext();
                        }, 450);
                    }
                }, 250);
            });
            observer.observe(root, { childList: true, subtree: true });
        }

        recordReadyDatasetSnapshot(reason, usableOptionIds, available) {
            if (!usableOptionIds.length || troopSum(available) <= 0) {
                return;
            }
            this.recordVisibleDatasetSnapshot(reason);
        }

        recordVisibleDatasetSnapshot(reason) {
            const snapshot = scrapeVisibleScavengeSnapshot(document);
            if (!snapshot.length) {
                return;
            }
            if (!snapshot.some(item => item.usable)) {
                return;
            }
            const signature = JSON.stringify(compactVisibleRunsForSignature(snapshot));
            if (signature === this.lastDatasetSnapshot) {
                return;
            }
            this.lastDatasetSnapshot = signature;
            const nextRun = nextActiveRun(this.activeRuns);
            appendDatasetEntry({
                type: 'visible_snapshot',
                reason,
                time: new Date().toISOString(),
                villageId: currentVillageId(),
                visibleRuns: snapshot,
                activeRuns: this.activeRuns,
                nextReturnSeconds: nextRun ? currentRemainingSeconds(nextRun) : null
            });
            this.renderDataset();
        }
    }

    function buildPlan({ models, settings, available, usableOptionIds, resources = null }) {
        const planningSettings = resolvePlanningSettings(settings);
        const usable = usableOptionIds
            .filter(optionId => planningSettings.allowedOptions[optionId] !== false)
            .filter(optionId => models.options.has(optionId))
            .sort((a, b) => b - a);

        const adjusted = adjustAvailableTroops(available, planningSettings, models);
        const availableCapacity = troopCapacity(adjusted, models.troops, models.haulFactor);

        if (!usable.length || populationUsed(adjusted, models.troops) < 10) {
            return {
                rows: [],
                availableCapacity,
                totalLoot: 0,
                effectiveLoot: 0,
                estimatedWaste: 0,
                lootPerHour: 0,
                effectiveLootPerHour: 0,
                horizonLoot: 0,
                runsPerHorizon: 0,
                maxDurationSeconds: 0,
                modeLabel: 'Žádný plán',
                settings: planningSettings,
                resources
            };
        }

        let targetCapacities;
        let modeLabel;

        if (planningSettings.mode === 'target') {
            targetCapacities = targetCapacitiesBestOptionsFirst(usable, models, planningSettings);
            modeLabel = 'Cílová délka, nejlepší možnosti první';
        } else if (planningSettings.mode === 'balanced') {
            targetCapacities = targetCapacitiesBalanced(usable, models, planningSettings, availableCapacity);
            modeLabel = 'Vyrovnaný výnos a čas návratu';
        } else {
            targetCapacities = targetCapacitiesEfficiency(usable, models, planningSettings, availableCapacity);
            modeLabel = `Nejvíc surovin/h od ${planningSettings.targetMinutes} do ${planningSettings.maxMinutes} min`;
        }

        targetCapacities = applyStoragePolicy(targetCapacities, usable, models, planningSettings, resources);

        const assigned = assignTroopsByTargetCapacity(usable, adjusted, targetCapacities, models);
        const rows = usable.map(optionId => makePlanRow(optionId, assigned.get(optionId), models))
            .filter(row => troopSum(row.troops) > 0);

        const maxDuration = rows.reduce((max, row) => Math.max(max, row.durationSeconds), 0);
        const totalLoot = rows.reduce((sum, row) => sum + row.lootTotal, 0);
        const estimatedWaste = estimateStorageWaste(totalLoot, resources);
        const effectiveLoot = Math.max(0, totalLoot - estimatedWaste);
        const lootPerHour = maxDuration > 0 ? totalLoot / (maxDuration / 3600) : 0;
        const effectiveLootPerHour = maxDuration > 0 ? effectiveLoot / (maxDuration / 3600) : 0;
        const horizonLoot = effectiveLootPerHour * planningSettings.horizonHours;
        const runsPerHorizon = maxDuration > 0
            ? (planningSettings.horizonHours * 3600) / maxDuration
            : 0;

        return {
            rows,
            availableCapacity,
            totalLoot,
            effectiveLoot,
            estimatedWaste,
            lootPerHour,
            effectiveLootPerHour,
            horizonLoot,
            runsPerHorizon,
            maxDurationSeconds: maxDuration,
            modeLabel,
            settings: planningSettings,
            resources
        };
    }

    function buildPlanComparisons({ models, settings, available, usableOptionIds, resources = null }) {
        const current = buildPlan({ models, settings, available, usableOptionIds, resources });
        const target = current.settings.targetMinutes;
        const max = Math.max(current.settings.maxMinutes, target);
        const scenarios = [
            {
                label: 'Aktuální',
                settings,
                isCurrent: true
            },
            {
                label: 'Aktivně optimum',
                settings: scenarioSettings(settings, {
                    profile: 'active',
                    mode: 'efficiency',
                    targetMinutes: 30,
                    maxMinutes: Math.max(180, max),
                    useTargetClock: false,
                    lightPolicy: settings.lightPolicy === 'never' ? 'never' : 'reserve'
                })
            },
            {
                label: `AFK ${target}m`,
                settings: scenarioSettings(settings, {
                    profile: 'afk',
                    mode: 'target',
                    targetMinutes: target,
                    maxMinutes: max,
                    useTargetClock: false,
                    lightPolicy: settings.lightPolicy === 'never' ? 'never' : 'afk'
                })
            },
            {
                label: 'Stejný výnos',
                settings: scenarioSettings(settings, {
                    mode: 'balanced',
                    targetMinutes: target,
                    maxMinutes: max,
                    useTargetClock: false
                })
            },
            {
                label: 'Bez LK/jízd. luku',
                settings: scenarioSettings(settings, {
                    lightPolicy: 'never',
                    targetMinutes: target,
                    maxMinutes: max,
                    useTargetClock: false
                })
            }
        ];

        return scenarios.map(scenario => {
            const plan = scenario.isCurrent
                ? current
                : buildPlan({ models, settings: scenario.settings, available, usableOptionIds, resources });
            return {
                label: scenario.label,
                isCurrent: !!scenario.isCurrent,
                settings: plan.settings,
                maxDurationSeconds: plan.maxDurationSeconds,
                totalLoot: plan.totalLoot,
                effectiveLoot: plan.effectiveLoot,
                estimatedWaste: plan.estimatedWaste,
                lootPerHour: plan.effectiveLootPerHour,
                runsPerHorizon: plan.runsPerHorizon,
                horizonLoot: plan.horizonLoot
            };
        });
    }

    function buildNextFillPreview({ models, settings, available, usableOptionIds, resources = null, activeRuns = [] }) {
        if (!activeRuns.length || usableOptionIds.length) {
            return null;
        }

        const nextRun = nextActiveRun(activeRuns);
        if (!nextRun) {
            return null;
        }

        const pending = findPendingRunForActiveRun(nextRun);
        const returningTroops = pending ? pendingRunTroops(pending) : null;
        const estimatedAvailable = returningTroops
            ? addCounts(available, returningTroops)
            : cloneCounts(available);
        const plan = buildPlan({
            models,
            settings,
            available: estimatedAvailable,
            usableOptionIds: [nextRun.optionId],
            resources
        });
        const row = plan.rows.find(item => item.optionId === nextRun.optionId) || plan.rows[0] || null;

        if (!row) {
            return {
                nextRun,
                row: null,
                usesReturningTroops: !!returningTroops,
                reason: returningTroops
                    ? 'ani po započtení známých vracejících jednotek nevychází použitelný plán.'
                    : 'neznám vracející se jednotky z tohoto běhu, takže zatím nevychází spolehlivý plán.'
            };
        }

        return {
            nextRun,
            row,
            usesReturningTroops: !!returningTroops
        };
    }

    function scenarioSettings(settings, overrides) {
        return normalizeSettings({
            ...settings,
            allowedOptions: { ...settings.allowedOptions },
            allowedTroops: { ...settings.allowedTroops },
            reserves: { ...settings.reserves },
            ...overrides
        });
    }

    function resolvePlanningSettings(settings) {
        const resolved = normalizeSettings(settings);
        if (resolved.useTargetClock && resolved.targetClock) {
            const minutes = minutesUntilClock(resolved.targetClock);
            resolved.targetMinutes = clampInt(minutes, 30, 48 * 60);
            resolved.maxMinutes = Math.max(resolved.maxMinutes, resolved.targetMinutes);
        }
        resolved.maxMinutes = Math.max(resolved.maxMinutes, resolved.targetMinutes);
        if (resolved.profile === 'active' && resolved.mode === 'efficiency') {
            resolved.maxMinutes = Math.max(resolved.maxMinutes, resolved.targetMinutes);
        }
        return resolved;
    }

    function applyProfileDefaults(settings, profile) {
        Object.assign(settings, PROFILE_DEFAULTS[profile] || PROFILE_DEFAULTS.afk);
    }

    function recommendPlan(comparisons) {
        const candidates = comparisons
            .filter(item => item.maxDurationSeconds > 0)
            .filter(item => item.estimatedWaste <= 0);
        const pool = candidates.length ? candidates : comparisons.filter(item => item.maxDurationSeconds > 0);
        if (!pool.length) {
            return null;
        }
        const best = [...pool].sort((a, b) => {
            if (b.lootPerHour !== a.lootPerHour) {
                return b.lootPerHour - a.lootPerHour;
            }
            return b.horizonLoot - a.horizonLoot;
        })[0];
        const reason = best.estimatedWaste > 0
            ? `má nejlepší efektivitu, ale pozor na možnou ztrátu ~${formatNumber(Math.round(best.estimatedWaste))}`
            : `nejlepší efektivní výnos bez ztrát: ${formatNumber(Math.round(best.lootPerHour))}/h`;
        return {
            label: best.label,
            reason
        };
    }

    function targetCapacitiesBestOptionsFirst(usable, models, settings) {
        const targetSeconds = settings.targetMinutes * 60;
        return targetCapacitiesGreedyForDuration(usable, models, Number.POSITIVE_INFINITY, targetSeconds);
    }

    function targetCapacitiesBalanced(usable, models, settings, availableCapacity) {
        const targetSeconds = settings.targetMinutes * 60;
        const inverseFactors = new Map();
        let inverseFactorSum = 0;
        let targetCapacitySum = 0;

        for (const optionId of usable) {
            const option = models.options.get(optionId);
            const inverse = 1 / option.loot_factor;
            inverseFactors.set(optionId, inverse);
            inverseFactorSum += inverse;
            targetCapacitySum += calcTargetCapacity(option, targetSeconds);
        }

        const overallPortion = availableCapacity > 0
            ? Math.min(1, targetCapacitySum / availableCapacity)
            : 0;

        const capacities = new Map();
        for (const optionId of usable) {
            const optionPortion = inverseFactors.get(optionId) / inverseFactorSum;
            capacities.set(optionId, availableCapacity * overallPortion * optionPortion);
        }
        return capacities;
    }

    function targetCapacitiesEfficiency(usable, models, settings, availableCapacity) {
        const minSeconds = Math.max(30, settings.targetMinutes) * 60;
        const maxSeconds = Math.max(settings.maxMinutes, 30) * 60;
        const stepSeconds = 60;
        let best = null;

        for (let seconds = minSeconds; seconds <= maxSeconds; seconds += stepSeconds) {
            const capacities = targetCapacitiesGreedyForDuration(usable, models, availableCapacity, seconds);
            let loot = 0;

            for (const optionId of usable) {
                loot += (capacities.get(optionId) || 0) * models.options.get(optionId).loot_factor;
            }

            if (loot <= 0) {
                continue;
            }

            const lootPerHour = loot / (seconds / 3600);
            if (!best || lootPerHour > best.lootPerHour) {
                best = { capacities, lootPerHour };
            }
        }

        if (best) {
            return best.capacities;
        }
        return targetCapacitiesBalanced(usable, models, settings, availableCapacity);
    }

    function targetCapacitiesGreedyForDuration(usable, models, availableCapacity, durationSeconds) {
        const capacities = new Map();
        let remainingCapacity = availableCapacity;

        for (const optionId of usable) {
            const option = models.options.get(optionId);
            const optionCapacity = calcTargetCapacity(option, durationSeconds);
            const capacity = Math.max(0, Math.min(remainingCapacity, optionCapacity));
            capacities.set(optionId, capacity);
            remainingCapacity -= capacity;
        }

        return capacities;
    }

    function applyStoragePolicy(targetCapacities, usable, models, settings, resources) {
        if (settings.storagePolicy !== 'cap') {
            return targetCapacities;
        }

        const maxLoot = maxExpectedLootBeforeStorageOverflow(resources);
        if (!Number.isFinite(maxLoot)) {
            return targetCapacities;
        }

        const plannedLoot = sumLootFromCapacities(targetCapacities, usable, models);
        if (plannedLoot <= maxLoot || plannedLoot <= 0) {
            return targetCapacities;
        }

        const scale = Math.max(0, maxLoot / plannedLoot);
        const scaled = new Map();
        for (const optionId of usable) {
            scaled.set(optionId, (targetCapacities.get(optionId) || 0) * scale);
        }
        return scaled;
    }

    function sumLootFromCapacities(capacities, usable, models) {
        return usable.reduce((sum, optionId) => {
            const option = models.options.get(optionId);
            return sum + (capacities.get(optionId) || 0) * option.loot_factor;
        }, 0);
    }

    function assignTroopsByTargetCapacity(usable, available, targetCapacities, models) {
        const assignedByOption = new Map();
        let remaining = cloneCounts(available);

        for (const optionId of usable) {
            const targetCapacity = targetCapacities.get(optionId) || 0;
            const assigned = chunkTroopsToCapacity(targetCapacity, remaining, models);
            assignedByOption.set(optionId, assigned);
            remaining = subtractCounts(remaining, assigned);
        }

        return assignedByOption;
    }

    function chunkTroopsToCapacity(targetCapacity, available, models) {
        const assigned = emptyCounts();

        for (const group of DEFAULT_TROOP_ORDER) {
            if (targetCapacity <= 0) {
                break;
            }

            let groupCapacity = 0;
            for (const type of group) {
                groupCapacity += available[type] * getTroopCarry(models.troops, type) * models.haulFactor;
            }

            if (groupCapacity <= 0) {
                continue;
            }

            const ratio = Math.min(1, targetCapacity / groupCapacity);
            for (const type of group) {
                const count = Math.floor(available[type] * ratio);
                assigned[type] += count;
                targetCapacity -= count * getTroopCarry(models.troops, type) * models.haulFactor;
            }

            topOffTroops(targetCapacity, available, assigned, group, models).forEach((count, type) => {
                assigned[type] += count;
                targetCapacity -= count * getTroopCarry(models.troops, type) * models.haulFactor;
            });
        }

        return assigned;
    }

    function topOffTroops(targetCapacity, available, assigned, group, models) {
        const extra = new Map();

        while (targetCapacity > 0) {
            let bestType = null;
            let bestDiff = Number.POSITIVE_INFINITY;

            for (const type of group) {
                const used = assigned[type] + (extra.get(type) || 0);
                if (available[type] <= used) {
                    continue;
                }
                const capacity = getTroopCarry(models.troops, type) * models.haulFactor;
                const diff = Math.abs(targetCapacity - capacity);
                if (diff < bestDiff) {
                    bestDiff = diff;
                    bestType = type;
                }
            }

            if (!bestType) {
                break;
            }

            const bestCapacity = getTroopCarry(models.troops, bestType) * models.haulFactor;
            if (targetCapacity < Math.abs(targetCapacity - bestCapacity)) {
                break;
            }

            extra.set(bestType, (extra.get(bestType) || 0) + 1);
            targetCapacity -= bestCapacity;
        }

        return extra;
    }

    function makePlanRow(optionId, troops, models) {
        const option = models.options.get(optionId);
        const capacity = troopCapacity(troops, models.troops, models.haulFactor);
        const durationSeconds = capacity > 0 ? calcDurationSeconds(option, capacity) : 0;
        const lootTotal = capacity * option.loot_factor;
        const lootPerHour = durationSeconds > 0 ? lootTotal / (durationSeconds / 3600) : 0;
        return { optionId, troops, capacity, durationSeconds, lootTotal, lootPerHour };
    }

    function calcDurationSeconds(option, squadCapacity) {
        const base = (squadCapacity ** 2) * (option.loot_factor * 100) * option.loot_factor;
        const preDuration = Math.pow(base, option.duration_exponent) + option.duration_initial_seconds;
        return Math.round(preDuration * option.duration_factor);
    }

    function calcTargetCapacity(option, durationSeconds) {
        const preDuration = durationSeconds / option.duration_factor;
        const adjusted = preDuration - option.duration_initial_seconds;
        if (adjusted <= 0) {
            return 0;
        }
        const base = adjusted ** (1 / option.duration_exponent);
        return Math.round(Math.sqrt(base / (option.loot_factor * 100) / option.loot_factor));
    }

    function scrapeScavengeModels(gameDoc) {
        const jsCode = findScavengeScreenJsCode(gameDoc);
        if (!jsCode) {
            throw new Error('Na stránce se nepodařilo najít data sběru surovin.');
        }

        const paramCode = findScavengeScreenParamCode(jsCode);
        const args = splitTopLevel(stripOuter(paramCode));
        const optionsConfig = JSON.parse(args[0]);
        const troops = JSON.parse(args[2]);
        const villageCode = findVillageCode(jsCode);
        const village = villageCode ? JSON.parse(villageCode) : {};

        return {
            options: new Map(Object.keys(optionsConfig).map(id => [parseInt(id, 10), optionsConfig[id]])),
            troops,
            sendableTroopTypes: Object.keys(troops).filter(type => getTroopCarry(troops, type) > 0),
            haulFactor: Number(village.unit_carry_factor || 1)
        };
    }

    function findScavengeScreenJsCode(gameDoc) {
        return Array.from(gameDoc.scripts)
            .map(script => script.textContent || '')
            .find(code => code.includes('new ScavengeScreen'));
    }

    function findScavengeScreenParamCode(jsCode) {
        const search = 'new ScavengeScreen';
        const start = jsCode.indexOf(search) + search.length;
        const openIndex = jsCode.indexOf('(', start);
        return wrappedCode(jsCode, openIndex, '(', ')');
    }

    function findVillageCode(jsCode) {
        const search = 'var village = ';
        const start = jsCode.indexOf(search);
        if (start < 0) {
            return null;
        }
        const openIndex = jsCode.indexOf('{', start + search.length);
        return wrappedCode(jsCode, openIndex, '{', '}');
    }

    function wrappedCode(text, openIndex, openChar, closeChar) {
        let depth = 0;
        let quote = null;
        let escaped = false;

        for (let i = openIndex; i < text.length; i += 1) {
            const char = text[i];

            if (quote) {
                if (escaped) {
                    escaped = false;
                } else if (char === '\\') {
                    escaped = true;
                } else if (char === quote) {
                    quote = null;
                }
                continue;
            }

            if (char === '"' || char === "'") {
                quote = char;
                continue;
            }
            if (char === openChar) {
                depth += 1;
            }
            if (char === closeChar) {
                depth -= 1;
                if (depth === 0) {
                    return text.slice(openIndex, i + 1);
                }
            }
        }

        throw new Error('Nepodařilo se zpracovat herní data.');
    }

    function stripOuter(text) {
        return text.trim().slice(1, -1);
    }

    function splitTopLevel(text) {
        const parts = [];
        let start = 0;
        let depth = 0;
        let quote = null;
        let escaped = false;

        for (let i = 0; i < text.length; i += 1) {
            const char = text[i];

            if (quote) {
                if (escaped) {
                    escaped = false;
                } else if (char === '\\') {
                    escaped = true;
                } else if (char === quote) {
                    quote = null;
                }
                continue;
            }

            if (char === '"' || char === "'") {
                quote = char;
                continue;
            }
            if (char === '{' || char === '[' || char === '(') {
                depth += 1;
            }
            if (char === '}' || char === ']' || char === ')') {
                depth -= 1;
            }
            if (char === ',' && depth === 0) {
                parts.push(text.slice(start, i).trim());
                start = i + 1;
            }
        }

        parts.push(text.slice(start).trim());
        return parts;
    }

    function scrapeAvailableTroopCounts(gameDoc) {
        const counts = emptyCounts();
        gameDoc.querySelectorAll('.units-entry-all[data-unit]').forEach(entry => {
            const type = entry.dataset.unit;
            counts[type] = parseGameNumber(entry.textContent);
        });
        return counts;
    }

    function scrapeResourceState(gameDoc) {
        const storage = parseGameNumber(textFromElement(gameDoc.querySelector('#storage')));
        if (!storage) {
            return null;
        }

        const values = {
            wood: parseGameNumber(textFromElement(gameDoc.querySelector('#wood'))),
            stone: parseGameNumber(textFromElement(gameDoc.querySelector('#stone'))),
            iron: parseGameNumber(textFromElement(gameDoc.querySelector('#iron')))
        };
        const free = {
            wood: Math.max(0, storage - values.wood),
            stone: Math.max(0, storage - values.stone),
            iron: Math.max(0, storage - values.iron)
        };

        return {
            capacity: storage,
            values,
            free
        };
    }

    function scrapeUsableOptionIds(gameDoc) {
        const ids = [];
        gameDoc.querySelectorAll('.scavenge-option').forEach((optionEl, index) => {
            const button = optionEl.querySelector('.free_send_button');
            if (!button || button.classList.contains('btn-disabled')) {
                return;
            }

            const portrait = optionEl.querySelector('.portrait');
            const image = portrait ? getComputedStyle(portrait).backgroundImage : '';
            const match = image.match(/options\/(\d+)\.png/);
            ids.push(match ? parseInt(match[1], 10) : index + 1);
        });
        return ids;
    }

    function usableOptionsSignature() {
        return scrapeUsableOptionIds(document).join(',');
    }

    function countScavengeOptions(gameDoc, models) {
        const visibleCount = gameDoc.querySelectorAll('.scavenge-option').length;
        if (visibleCount) {
            return visibleCount;
        }
        return models && models.options ? models.options.size : 0;
    }

    function scrapeActiveScavengeRuns(gameDoc) {
        return Array.from(gameDoc.querySelectorAll('.scavenge-option')).map((optionEl, index) => {
            const optionId = scrapeOptionId(optionEl, index);
            const text = optionEl.textContent || '';
            const duration = parseDurationFromText(text);
            const active = isActiveScavengeOption(optionEl, text, duration);
            if (!active) {
                return null;
            }
            const lootNumbers = scrapeVisibleResourceNumbers(optionEl);
            return {
                optionId,
                name: scrapeOptionName(optionEl, text),
                remainingSeconds: duration ? duration.seconds : null,
                remainingText: duration ? duration.text : '',
                expectedLoot: {
                    wood: lootNumbers[0] || 0,
                    stone: lootNumbers[1] || 0,
                    iron: lootNumbers[2] || 0
                },
                expectedTotal: lootNumbers.reduce((sum, value) => sum + value, 0),
                scrapedAt: Date.now()
            };
        }).filter(Boolean);
    }

    function isActiveScavengeOption(optionEl, text, duration) {
        if (/Sbírání|Sbirani|Scaveng/i.test(text) && duration) {
            return true;
        }
        const button = optionEl.querySelector('.free_send_button');
        return !button && !!duration && scrapeVisibleResourceNumbers(optionEl).length >= 3;
    }

    function scrapeOptionName(optionEl, text) {
        const direct = optionEl.querySelector('.title, .option-title, h3, h4, strong');
        if (direct && direct.textContent.trim()) {
            return direct.textContent.trim();
        }
        const lines = String(text || '').split(/\n+/)
            .map(line => line.trim())
            .filter(Boolean);
        return lines.find(line => {
            if (/Sbírání|Sbirani|Scaveng|surovin/i.test(line)) {
                return false;
            }
            if (parseDurationFromText(line)) {
                return false;
            }
            if (/\d/.test(line)) {
                return false;
            }
            return line.length <= 40;
        }) || '';
    }

    function parseDurationFromText(text) {
        const match = String(text || '').match(/\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b/);
        if (!match) {
            return null;
        }
        const first = match[1] === undefined ? 0 : parseInt(match[1], 10);
        const second = parseInt(match[2], 10);
        const third = parseInt(match[3], 10);
        const seconds = match[1] === undefined
            ? second * 60 + third
            : first * 3600 + second * 60 + third;
        return {
            text: match[0],
            seconds
        };
    }

    function scrapeVisibleScavengeSnapshot(gameDoc) {
        return Array.from(gameDoc.querySelectorAll('.scavenge-option')).map((optionEl, index) => {
            const optionId = scrapeOptionId(optionEl, index);
            const button = optionEl.querySelector('.free_send_button');
            const text = optionEl.textContent || '';
            const duration = parseDurationFromText(text);
            const lootNumbers = scrapeVisibleResourceNumbers(optionEl);
            const active = isActiveScavengeOption(optionEl, text, duration);
            return {
                optionId,
                usable: !!button && !button.classList.contains('btn-disabled'),
                active,
                remainingSeconds: active && duration ? duration.seconds : null,
                remainingText: active && duration ? duration.text : '',
                lootNumbers,
                expectedTotal: lootNumbers.reduce((sum, value) => sum + value, 0),
                textHash: simpleHash([
                    optionId,
                    button && !button.classList.contains('btn-disabled') ? 'usable' : 'blocked',
                    active ? 'active' : 'idle',
                    lootNumbers.join(',')
                ].join('|'))
            };
        });
    }

    function scrapeOptionId(optionEl, index) {
        const portrait = optionEl.querySelector('.portrait');
        const image = portrait ? getComputedStyle(portrait).backgroundImage : '';
        const match = image.match(/options\/(\d+)\.png/);
        return match ? parseInt(match[1], 10) : index + 1;
    }

    function scrapeVisibleResourceNumbers(optionEl) {
        const numbers = [];
        optionEl.querySelectorAll('.wood, .stone, .iron').forEach(icon => {
            const text = icon.parentElement ? icon.parentElement.textContent : '';
            const value = parseGameNumber(text);
            if (value) {
                numbers.push(value);
            }
        });
        if (numbers.length) {
            return numbers.slice(0, 3);
        }
        return Array.from((optionEl.textContent || '').matchAll(/\b\d{1,6}\b/g))
            .map(match => parseInt(match[0], 10))
            .filter(value => value > 0)
            .slice(0, 3);
    }

    function simpleHash(text) {
        let hash = 0;
        for (let i = 0; i < text.length; i += 1) {
            hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
        }
        return String(hash);
    }

    function scanActualScavengeResults(gameDoc) {
        const summary = {
            ...emptyReportScan()
        };
        if (!isReportDetailPage()) {
            return summary;
        }
        const results = scrapeActualScavengeResults(gameDoc);
        summary.found = results.length;
        if (!results.length) {
            return summary;
        }

        for (const result of results) {
            if (actualResultAlreadyStored(result)) {
                summary.duplicates += 1;
                continue;
            }
            const match = matchPendingRun(result);
            const entry = {
                type: 'actual_result',
                runId: match ? match.runId : null,
                time: new Date().toISOString(),
                source: result.source,
                world: location.hostname,
                villageId: match ? match.villageId : currentVillageId(),
                optionId: match ? match.optionId : null,
                expectedTotal: match ? match.expectedTotal : null,
                actualTotal: result.total,
                actualLoot: result.loot,
                delta: match ? result.total - match.expectedTotal : null,
                matched: !!match,
                textHash: result.textHash
            };
            appendDatasetEntry(entry);
            queueAnonymousShareFromActual(entry, match);
            summary.stored += 1;
            if (match) {
                summary.matched += 1;
                markPendingRunMatched(match.runId, entry);
            }
        }
        return summary;
    }

    function scrapeActualScavengeResults(gameDoc) {
        if (!isReportDetailPage()) {
            return [];
        }
        const element = gameDoc.querySelector('.report_Report') || gameDoc.querySelector('#content_value');
        if (!element) {
            return [];
        }
        const text = normalizeText(element.textContent || '');
        if (!isScavengeResultText(text)) {
            return [];
        }
        const loot = extractLootFromElement(element, text);
        const total = loot.wood + loot.stone + loot.iron;
        if (total <= 0) {
            return [];
        }
        return [{
            source: document.location.href,
            textHash: simpleHash(`${location.href}|${total}|${loot.wood}|${loot.stone}|${loot.iron}`),
            loot,
            total
        }];
    }

    function isScavengeResultText(text) {
        return /sběr surovin|sber surovin|sběrač|sberac|sběrači|sberaci|scaveng/i.test(text)
            && /dřevo|drevo|wood|hlína|hlina|clay|stone|železo|zelezo|iron|surovin/i.test(text);
    }

    function extractLootFromElement(element, text) {
        const byIcon = extractLootByResourceIcons(element);
        if (byIcon.wood || byIcon.stone || byIcon.iron) {
            return byIcon;
        }
        return extractLootByText(text);
    }

    function extractLootByResourceIcons(element) {
        const loot = { wood: 0, stone: 0, iron: 0 };
        for (const resource of ['wood', 'stone', 'iron']) {
            const resourceElement = element.querySelector(`.${resource}`);
            if (!resourceElement) {
                continue;
            }
            const rowText = resourceElement.parentElement ? resourceElement.parentElement.textContent : resourceElement.textContent;
            loot[resource] = parseGameNumber(rowText);
        }
        return loot;
    }

    function extractLootByText(text) {
        const loot = { wood: 0, stone: 0, iron: 0 };
        const patterns = {
            wood: /(?:dřevo|drevo|wood)[^\d]{0,20}([\d .]+)/i,
            stone: /(?:hlína|hlina|clay|stone)[^\d]{0,20}([\d .]+)/i,
            iron: /(?:železo|zelezo|iron)[^\d]{0,20}([\d .]+)/i
        };
        for (const [resource, pattern] of Object.entries(patterns)) {
            const match = text.match(pattern);
            if (match) {
                loot[resource] = parseGameNumber(match[1]);
            }
        }
        return loot;
    }

    function matchPendingRun(result) {
        const runs = loadPendingRuns().filter(run => !run.matched && run.world === location.hostname);
        if (!runs.length) {
            return null;
        }
        const best = runs
            .map(run => ({
                run,
                score: Math.abs((run.expectedTotal || 0) - result.total)
            }))
            .sort((a, b) => a.score - b.score)[0];
        const tolerance = Math.max(20, (best.run.expectedTotal || 0) * 0.15);
        return best.score <= tolerance ? best.run : null;
    }

    function findPendingRunForActiveRun(activeRun) {
        const runs = loadPendingRuns().filter(run => {
            if (run.matched || run.world !== location.hostname) {
                return false;
            }
            return !run.optionId || run.optionId === activeRun.optionId;
        });
        if (!runs.length) {
            return null;
        }
        return runs
            .map(run => ({
                run,
                score: Math.abs((run.expectedTotal || 0) - (activeRun.expectedTotal || 0))
                    + (run.optionId === activeRun.optionId ? 0 : 1000000)
            }))
            .sort((a, b) => a.score - b.score)[0].run;
    }

    function pendingRunTroops(run) {
        const rows = Array.isArray(run.rows) ? run.rows : [];
        if (!rows.length) {
            return null;
        }
        return rows.reduce((sum, row) => addCounts(sum, row.troops || {}), emptyCounts());
    }

    function markPendingRunMatched(runId, actualEntry) {
        const runs = loadPendingRuns().map(run => {
            if (run.runId !== runId) {
                return run;
            }
            return {
                ...run,
                matched: true,
                actualTime: actualEntry.time,
                actualTotal: actualEntry.actualTotal,
                delta: actualEntry.delta
            };
        });
        savePendingRuns(runs);
    }

    function actualResultAlreadyStored(result) {
        return loadDataset().some(entry => entry.type === 'actual_result' && entry.textHash === result.textHash);
    }

    function normalizeText(text) {
        return String(text || '').replace(/\s+/g, ' ').trim();
    }

    function adjustAvailableTroops(available, settings, models) {
        const adjusted = emptyCounts();
        for (const type of TROOP_TYPES) {
            if (!isTroopAllowedForPlan(type, settings)) {
                continue;
            }
            if (getTroopCarry(models.troops, type) <= 0) {
                continue;
            }
            const availableCount = available[type] || 0;
            const percentReserve = Math.floor(availableCount * settings.reservePercent / 100);
            const threatReserve = Math.floor(availableCount * threatReservePercent(type, settings) / 100);
            adjusted[type] = Math.max(0, availableCount - (settings.reserves[type] || 0) - percentReserve - threatReserve);
        }
        return adjusted;
    }

    function threatReservePercent(type, settings) {
        if (!DEFENSIVE_UNITS.has(type)) {
            return 0;
        }
        return THREAT_RESERVE_PERCENT[settings.threatLevel] || 0;
    }

    function isTroopAllowedForPlan(type, settings) {
        if (settings.allowedTroops[type] === false) {
            return false;
        }
        if (!FAST_RAIDERS.has(type)) {
            return true;
        }
        if (settings.lightPolicy === 'never') {
            return false;
        }
        if (settings.lightPolicy === 'afk') {
            return settings.profile === 'afk' || settings.profile === 'night';
        }
        return true;
    }

    function fillTroopInputs(troops) {
        for (const type of TROOP_TYPES) {
            const input = document.querySelector(`.unitsInput[name="${type}"]`);
            if (!input) {
                continue;
            }
            input.value = troops[type] || 0;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    function focusStartButton(optionId) {
        const option = Array.from(document.querySelectorAll('.scavenge-option'))
            .find((element, index) => {
                const portrait = element.querySelector('.portrait');
                const image = portrait ? getComputedStyle(portrait).backgroundImage : '';
                const match = image.match(/options\/(\d+)\.png/);
                return match ? parseInt(match[1], 10) === optionId : index + 1 === optionId;
            });
        const button = option && option.querySelector('.free_send_button');
        if (button) {
            button.focus();
        }
    }

    function emptyCounts() {
        return Object.fromEntries(TROOP_TYPES.map(type => [type, 0]));
    }

    function cloneCounts(counts) {
        return Object.assign(emptyCounts(), counts);
    }

    function subtractCounts(left, right) {
        const result = emptyCounts();
        for (const type of TROOP_TYPES) {
            result[type] = Math.max(0, (left[type] || 0) - (right[type] || 0));
        }
        return result;
    }

    function addCounts(left, right) {
        const result = emptyCounts();
        for (const type of TROOP_TYPES) {
            result[type] = (left[type] || 0) + (right[type] || 0);
        }
        return result;
    }

    function troopSum(counts) {
        return TROOP_TYPES.reduce((sum, type) => sum + (counts[type] || 0), 0);
    }

    function troopCapacity(counts, troopsConfig, haulFactor) {
        return TROOP_TYPES.reduce((sum, type) => {
            return sum + (counts[type] || 0) * getTroopCarry(troopsConfig, type) * haulFactor;
        }, 0);
    }

    function populationUsed(counts, troopsConfig) {
        return TROOP_TYPES.reduce((sum, type) => {
            return sum + (counts[type] || 0) * getTroopPop(troopsConfig, type);
        }, 0);
    }

    function getTroopCarry(troopsConfig, type) {
        return Number((troopsConfig[type] && troopsConfig[type].carry) || DEFAULT_CARRY[type] || 0);
    }

    function getTroopPop(troopsConfig, type) {
        return Number((troopsConfig[type] && troopsConfig[type].pop) || DEFAULT_POP[type] || 0);
    }

    function defaultSettings() {
        return {
            profile: 'afk',
            mode: 'efficiency',
            targetMinutes: 180,
            useTargetClock: false,
            targetClock: '21:00',
            maxMinutes: 480,
            reservePercent: 0,
            lightPolicy: 'afk',
            threatLevel: 'normal',
            storagePolicy: 'warn',
            horizonHours: 24,
            autoFillNext: true,
            dataSharing: {
                enabled: false,
                consentGiven: false
            },
            allowedOptions: { 1: true, 2: true, 3: true, 4: true },
            allowedTroops: Object.fromEntries(TROOP_TYPES.map(type => [type, type !== 'knight'])),
            reserves: Object.fromEntries(TROOP_TYPES.map(type => [type, 0]))
        };
    }

    function defaultUiState() {
        return {
            ...DEFAULT_UI_STATE,
            left: Math.max(8, window.innerWidth - DEFAULT_UI_STATE.width - 16)
        };
    }

    function loadSettings() {
        try {
            return normalizeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
        } catch (_) {
            return defaultSettings();
        }
    }

    function loadUiState() {
        try {
            return normalizeUiState(JSON.parse(localStorage.getItem(UI_KEY) || '{}'));
        } catch (_) {
            return defaultUiState();
        }
    }

    function saveUiState(uiState) {
        localStorage.setItem(UI_KEY, JSON.stringify(normalizeUiState(uiState)));
    }

    function normalizeUiState(raw) {
        const defaults = defaultUiState();
        const state = {
            ...defaults,
            ...(raw || {})
        };
        const maxWidth = Math.max(360, window.innerWidth - 16);
        const maxLeft = Math.max(0, window.innerWidth - 80);
        const maxTop = Math.max(0, window.innerHeight - 40);

        state.width = clampInt(state.width, 330, maxWidth);
        state.scale = clampInt(state.scale, 80, 130);
        state.left = clampNumber(Number(state.left), 0, maxLeft);
        state.top = clampNumber(Number(state.top), 0, maxTop);
        state.collapsed = !!state.collapsed;

        return state;
    }

    function normalizeSettings(raw) {
        const defaults = defaultSettings();
        const settings = {
            ...defaults,
            ...raw,
            allowedOptions: {
                ...defaults.allowedOptions,
                ...(raw && raw.allowedOptions ? raw.allowedOptions : {})
            },
            allowedTroops: {
                ...defaults.allowedTroops,
                ...(raw && raw.allowedTroops ? raw.allowedTroops : {})
            },
            reserves: {
                ...defaults.reserves,
                ...(raw && raw.reserves ? raw.reserves : {})
            },
            dataSharing: {
                ...defaults.dataSharing,
                ...(raw && raw.dataSharing ? raw.dataSharing : {})
            }
        };

        settings.profile = PROFILE_DEFAULTS[settings.profile] ? settings.profile : 'afk';
        settings.mode = ['efficiency', 'balanced', 'target'].includes(settings.mode) ? settings.mode : 'efficiency';
        settings.targetMinutes = clampInt(settings.targetMinutes, 30, 48 * 60);
        settings.maxMinutes = clampInt(settings.maxMinutes, 30, 72 * 60);
        settings.reservePercent = clampInt(settings.reservePercent, 0, 90);
        settings.lightPolicy = ['never', 'reserve', 'afk', 'always'].includes(settings.lightPolicy)
            ? settings.lightPolicy
            : 'afk';
        settings.threatLevel = ['calm', 'normal', 'elevated', 'high'].includes(settings.threatLevel)
            ? settings.threatLevel
            : 'normal';
        settings.storagePolicy = ['warn', 'cap', 'ignore'].includes(settings.storagePolicy)
            ? settings.storagePolicy
            : 'warn';
        settings.horizonHours = clampInt(settings.horizonHours, 1, 72);
        settings.autoFillNext = settings.autoFillNext !== false;
        settings.dataSharing.enabled = !!settings.dataSharing.enabled;
        settings.dataSharing.consentGiven = !!settings.dataSharing.consentGiven && settings.dataSharing.enabled;
        settings.useTargetClock = !!settings.useTargetClock;
        settings.targetClock = /^\d{2}:\d{2}$/.test(settings.targetClock || '') ? settings.targetClock : '21:00';

        return settings;
    }

    function saveSettings(settings) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }

    function loadLog() {
        try {
            const log = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
            return Array.isArray(log) ? log : [];
        } catch (_) {
            return [];
        }
    }

    function saveLog(log) {
        localStorage.setItem(LOG_KEY, JSON.stringify(log));
    }

    function loadDataset() {
        try {
            const dataset = JSON.parse(localStorage.getItem(DATASET_KEY) || '[]');
            return Array.isArray(dataset) ? dataset : [];
        } catch (_) {
            return [];
        }
    }

    function latestDatasetEntry(predicate) {
        const dataset = loadDataset();
        for (let i = dataset.length - 1; i >= 0; i -= 1) {
            if (predicate(dataset[i])) {
                return dataset[i];
            }
        }
        return null;
    }

    function summarizeDataset(dataset) {
        const entries = Array.isArray(dataset) ? dataset : [];
        const matchedActuals = entries
            .filter(entry => entry.type === 'actual_result' && entry.matched && entry.expectedTotal > 0 && entry.actualTotal > 0)
            .map(entry => {
                const expected = Number(entry.expectedTotal) || 0;
                const actual = Number(entry.actualTotal) || 0;
                const delta = actual - expected;
                return {
                    time: entry.time || '',
                    expected,
                    actual,
                    delta,
                    deltaPct: expected > 0 ? (delta / expected) * 100 : 0,
                    absPct: expected > 0 ? (Math.abs(delta) / expected) * 100 : 0
                };
            });
        const expectedSum = matchedActuals.reduce((sum, item) => sum + item.expected, 0);
        const actualSum = matchedActuals.reduce((sum, item) => sum + item.actual, 0);

        return {
            total: entries.length,
            planned: entries.filter(entry => entry.type === 'planned_fill').length,
            actual: entries.filter(entry => entry.type === 'actual_result').length,
            matched: matchedActuals.length,
            snapshots: entries.filter(entry => entry.type === 'visible_snapshot').length,
            accuracy: {
                count: matchedActuals.length,
                expectedSum,
                actualSum,
                avgPct: average(matchedActuals.map(item => item.deltaPct)),
                avgAbsPct: average(matchedActuals.map(item => item.absPct)),
                totalRatioPct: expectedSum > 0 ? (actualSum / expectedSum) * 100 : 0,
                latest: matchedActuals.slice(-5).reverse()
            }
        };
    }

    function average(values) {
        const usable = values.filter(value => Number.isFinite(value));
        if (!usable.length) {
            return 0;
        }
        return usable.reduce((sum, value) => sum + value, 0) / usable.length;
    }

    function saveDataset(dataset) {
        localStorage.setItem(DATASET_KEY, JSON.stringify(dataset.slice(-500)));
    }

    function loadPendingRuns() {
        try {
            const runs = JSON.parse(localStorage.getItem(PENDING_RUNS_KEY) || '[]');
            return Array.isArray(runs) ? runs : [];
        } catch (_) {
            return [];
        }
    }

    function savePendingRuns(runs) {
        localStorage.setItem(PENDING_RUNS_KEY, JSON.stringify(runs.slice(-100)));
    }

    function loadDataSharingBuffer() {
        try {
            const buffer = JSON.parse(localStorage.getItem(DATA_SHARING_BUFFER_KEY) || '[]');
            return Array.isArray(buffer) ? buffer : [];
        } catch (_) {
            return [];
        }
    }

    function saveDataSharingBuffer(buffer) {
        localStorage.setItem(DATA_SHARING_BUFFER_KEY, JSON.stringify(buffer.slice(-100)));
    }

    function dataSharingAllowed(settings = loadSettings()) {
        return !!(
            settings
            && settings.dataSharing
            && settings.dataSharing.enabled
            && settings.dataSharing.consentGiven
        );
    }

    function queueAnonymousShareFromActual(actualEntry, matchedRun) {
        const settings = loadSettings();
        if (!dataSharingAllowed(settings)) {
            return;
        }
        const record = makeAnonymousShareRecord(actualEntry, matchedRun);
        if (!record) {
            return;
        }
        const buffer = loadDataSharingBuffer();
        buffer.push(record);
        saveDataSharingBuffer(buffer);
        if (buffer.length >= DATA_SHARING_BATCH_SIZE) {
            flushDataSharingBuffer(settings, false);
        }
    }

    function makeAnonymousShareRecord(actualEntry, matchedRun) {
        if (!actualEntry || !matchedRun || !matchedRun.optionId) {
            return null;
        }
        const troops = sanitizeTroopsForSharing(pendingRunTroops(matchedRun));
        if (!troopSum(troops)) {
            return null;
        }
        return {
            world: String(actualEntry.world || location.hostname || ''),
            option: Number(matchedRun.optionId),
            duration_s: Math.round(Number(matchedRun.durationSeconds) || 0),
            troops,
            expected: Math.round(Number(matchedRun.expectedTotal) || 0),
            actual: Math.round(Number(actualEntry.actualTotal) || 0),
            ts: roundedShareTimestamp(Date.now())
        };
    }

    function sanitizeTroopsForSharing(troops) {
        const safe = emptyCounts();
        for (const type of TROOP_TYPES) {
            const count = Math.max(0, Math.floor(Number(troops && troops[type]) || 0));
            if (count > 0) {
                safe[type] = count;
            }
        }
        return safe;
    }

    function roundedShareTimestamp(timeMs) {
        const seconds = Math.floor(Number(timeMs || Date.now()) / 1000);
        return Math.floor(seconds / DATA_SHARING_TS_BUCKET_SECONDS) * DATA_SHARING_TS_BUCKET_SECONDS;
    }

    async function flushDataSharingBuffer(settings = loadSettings(), manual = false) {
        if (!dataSharingAllowed(settings)) {
            return false;
        }
        const buffer = loadDataSharingBuffer();
        if (!buffer.length || (!manual && buffer.length < DATA_SHARING_BATCH_SIZE)) {
            return false;
        }
        const batch = buffer.slice(0, manual ? buffer.length : DATA_SHARING_BATCH_SIZE);
        const ok = await sendBatch(batch);
        if (!ok) {
            return false;
        }
        saveDataSharingBuffer(buffer.slice(batch.length));
        return true;
    }

    async function sendBatch(batch) {
        try {
            const response = await fetch(DATA_SHARING_ENDPOINT, {
                method: 'POST',
                credentials: 'omit',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(batch)
            });
            return response.ok;
        } catch (_) {
            return false;
        }
    }

    function appendPendingRun(plannedEntry) {
        const runs = loadPendingRuns();
        const duplicate = runs.some(run => {
            if (run.matched || run.world !== plannedEntry.world || run.villageId !== plannedEntry.villageId) {
                return false;
            }
            const ageMs = Date.parse(plannedEntry.time) - Date.parse(run.time);
            if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 5000) {
                return false;
            }
            return Math.round(run.expectedTotal || 0) === Math.round(plannedEntry.expectedTotal || 0)
                && Math.round(run.durationSeconds || 0) === Math.round(plannedEntry.durationSeconds || 0)
                && JSON.stringify(run.rows || []) === JSON.stringify(plannedEntry.rows || []);
        });
        if (duplicate) {
            return;
        }
        runs.push({
            runId: plannedEntry.runId,
            time: plannedEntry.time,
            world: plannedEntry.world,
            villageId: plannedEntry.villageId,
            optionId: plannedEntry.optionId || null,
            expectedTotal: plannedEntry.expectedTotal,
            effectiveLoot: plannedEntry.effectiveLoot,
            durationSeconds: plannedEntry.durationSeconds,
            rows: plannedEntry.rows || [],
            matched: false
        });
        savePendingRuns(runs);
    }

    function appendDatasetEntry(entry) {
        const dataset = loadDataset();
        const signature = datasetEntrySignature(entry);
        const last = dataset[dataset.length - 1];
        if (last && datasetEntrySignature(last) === signature) {
            return;
        }
        dataset.push(entry);
        saveDataset(dataset);
    }

    function datasetEntrySignature(entry) {
        return JSON.stringify({
            type: entry.type,
            reason: entry.reason,
            runId: entry.type === 'planned_fill' ? null : entry.runId || null,
            villageId: entry.villageId,
            expectedTotal: Math.round(entry.expectedTotal || 0),
            actualTotal: Math.round(entry.actualTotal || 0),
            durationSeconds: Math.round(entry.durationSeconds || 0),
            rows: entry.rows || null,
            visibleRuns: compactVisibleRunsForSignature(entry.visibleRuns),
            activeRuns: compactActiveRunsForSignature(entry.activeRuns)
        });
    }

    function compactVisibleRunsForSignature(visibleRuns) {
        if (!Array.isArray(visibleRuns)) {
            return null;
        }
        return visibleRuns.map(run => ({
            optionId: run.optionId,
            usable: !!run.usable,
            active: !!run.active,
            expectedTotal: Math.round(run.expectedTotal || 0),
            textHash: run.textHash
        }));
    }

    function compactActiveRunsForSignature(activeRuns) {
        if (!Array.isArray(activeRuns)) {
            return null;
        }
        return activeRuns.map(run => ({
            optionId: run.optionId,
            expectedTotal: Math.round(run.expectedTotal || 0)
        }));
    }

    function selectedPlanRows(plan, optionId = null) {
        const rows = optionId
            ? plan.rows.filter(row => row.optionId === optionId)
            : plan.rows;
        return rows.map(row => ({
            optionId: row.optionId,
            durationSeconds: row.durationSeconds,
            lootTotal: row.lootTotal,
            lootPerHour: row.lootPerHour,
            troops: row.troops
        }));
    }

    function summarizePlanRows(rows, resources) {
        const durationSeconds = rows.reduce((max, row) => Math.max(max, row.durationSeconds || 0), 0);
        const expectedTotal = rows.reduce((sum, row) => sum + (row.lootTotal || 0), 0);
        const estimatedWaste = estimateStorageWaste(expectedTotal, resources);
        const effectiveLoot = Math.max(0, expectedTotal - estimatedWaste);
        const effectiveLootPerHour = durationSeconds > 0
            ? effectiveLoot / (durationSeconds / 3600)
            : 0;
        return {
            durationSeconds,
            expectedTotal,
            estimatedWaste,
            effectiveLoot,
            effectiveLootPerHour
        };
    }

    function createDatasetEntry(reason, plan, settings, optionId = null) {
        const runId = createRunId();
        const rows = selectedPlanRows(plan, optionId);
        const summary = summarizePlanRows(rows, plan.resources);
        return {
            type: 'planned_fill',
            runId,
            reason,
            time: new Date().toISOString(),
            villageId: currentVillageId(),
            world: location.hostname,
            optionId,
            profile: settings.profile,
            mode: settings.mode,
            settings: {
                targetMinutes: plan.settings.targetMinutes,
                maxMinutes: plan.settings.maxMinutes,
                reservePercent: plan.settings.reservePercent,
                lightPolicy: plan.settings.lightPolicy,
                storagePolicy: plan.settings.storagePolicy
            },
            expectedTotal: summary.expectedTotal,
            effectiveLoot: summary.effectiveLoot,
            estimatedWaste: summary.estimatedWaste,
            effectiveLootPerHour: summary.effectiveLootPerHour,
            durationSeconds: summary.durationSeconds,
            rows,
            visibleRuns: scrapeVisibleScavengeSnapshot(document),
            activeRuns: scrapeActiveScavengeRuns(document)
        };
    }

    function createRunId() {
        return [
            Date.now().toString(36),
            Math.random().toString(36).slice(2, 8)
        ].join('-');
    }

    function currentVillageId() {
        if (window.game_data && window.game_data.village) {
            return String(window.game_data.village.id || '');
        }
        return new URLSearchParams(location.search).get('village') || '';
    }

    function estimateStorageWaste(totalLoot, resources) {
        if (!resources || !resources.capacity || totalLoot <= 0) {
            return 0;
        }

        const expectedPerResource = totalLoot / 3;
        return ['wood', 'stone', 'iron'].reduce((sum, resource) => {
            return sum + Math.max(0, expectedPerResource - resources.free[resource]);
        }, 0);
    }

    function maxExpectedLootBeforeStorageOverflow(resources) {
        if (!resources || !resources.capacity) {
            return Number.POSITIVE_INFINITY;
        }
        const smallestFreeSpace = Math.min(resources.free.wood, resources.free.stone, resources.free.iron);
        return Math.max(0, smallestFreeSpace * 3);
    }

    function parseGameNumber(text) {
        const cleaned = String(text || '').replace(/[^\d]/g, '');
        return cleaned ? parseInt(cleaned, 10) : 0;
    }

    function clampInt(value, min, max) {
        const parsed = parseInt(value, 10);
        if (Number.isNaN(parsed)) {
            return min;
        }
        return Math.max(min, Math.min(max, parsed));
    }

    function clampNumber(value, min, max) {
        if (!Number.isFinite(value)) {
            return min;
        }
        return Math.max(min, Math.min(max, value));
    }

    function minutesUntilClock(clock) {
        const now = getServerNow();
        const [hours, minutes] = clock.split(':').map(part => parseInt(part, 10));
        const target = new Date(now.getTime());
        target.setHours(hours, minutes, 0, 0);
        if (target <= now) {
            target.setDate(target.getDate() + 1);
        }
        return Math.ceil((target.getTime() - now.getTime()) / 60000);
    }

    function getServerNow() {
        const timeText = textFromSelector('#serverTime');
        const dateText = textFromSelector('#serverDate');
        const timeMatch = timeText.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
        const dateMatch = dateText.match(/(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);

        if (timeMatch && dateMatch) {
            const day = Number(dateMatch[1]);
            const month = Number(dateMatch[2]);
            const year = Number(dateMatch[3]);
            const hour = Number(timeMatch[1]);
            const minute = Number(timeMatch[2]);
            const second = Number(timeMatch[3] || 0);
            return new Date(year, month - 1, day, hour, minute, second);
        }

        return new Date();
    }

    function textFromSelector(selector) {
        const element = document.querySelector(selector);
        return element ? element.textContent.trim() : '';
    }

    function textFromElement(element) {
        return element ? element.textContent.trim() : '';
    }

    function nextActiveRun(activeRuns) {
        return [...(activeRuns || [])]
            .filter(run => Number.isFinite(currentRemainingSeconds(run)))
            .sort((a, b) => currentRemainingSeconds(a) - currentRemainingSeconds(b))[0] || null;
    }

    function currentRemainingSeconds(run) {
        if (!run || !Number.isFinite(run.remainingSeconds)) {
            return Number.POSITIVE_INFINITY;
        }
        const elapsed = Math.floor((Date.now() - (run.scrapedAt || Date.now())) / 1000);
        return Math.max(0, run.remainingSeconds - elapsed);
    }

    function formatRemainingTime(seconds) {
        if (!Number.isFinite(seconds)) {
            return '-';
        }
        const total = Math.max(0, Math.round(seconds));
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const secs = total % 60;
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    function formatShortRemaining(seconds) {
        if (!Number.isFinite(seconds)) {
            return '-';
        }
        const totalMinutes = Math.max(0, Math.ceil(seconds / 60));
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        if (hours <= 0) {
            return `${minutes}m`;
        }
        if (minutes <= 0) {
            return `${hours}h`;
        }
        return `${hours}h ${minutes}m`;
    }

    function formatDuration(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return `${hours}:${String(minutes).padStart(2, '0')}`;
    }

    function formatNumber(value) {
        return Number(value || 0).toLocaleString();
    }

    function formatSignedNumber(value) {
        const number = Math.round(Number(value || 0));
        return `${number >= 0 ? '+' : '-'}${formatNumber(Math.abs(number))}`;
    }

    function formatDecimal(value, decimals) {
        return Number(value || 0).toLocaleString(undefined, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    }

    function formatPercent(value) {
        return `${formatDecimal(value, 1)}%`;
    }

    function formatSignedPercent(value) {
        const number = Number(value || 0);
        return `${number >= 0 ? '+' : '-'}${formatDecimal(Math.abs(number), 1)}%`;
    }

    function shortTime(value) {
        if (!value) {
            return '-';
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return String(value).slice(0, 16);
        }
        return date.toLocaleString(undefined, {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function formatTroopCounts(counts) {
        const parts = TROOP_TYPES
            .filter(type => counts[type] > 0)
            .map(type => `${troopLabel(type)}:${counts[type]}`);
        return parts.length ? parts.join(' ') : '-';
    }

    function formatStorageSummary(resources) {
        if (!resources || !resources.capacity) {
            return '';
        }
        const free = ['wood', 'stone', 'iron']
            .map(resource => `${RESOURCE_LABELS[resource]} ${formatNumber(resources.free[resource])}`)
            .join(', ');
        return `Volné místo ve skladu: ${free}.`;
    }

    function troopLabel(type) {
        return TROOP_LABELS[type] || type;
    }

    function profileLabel(profile) {
        return {
            active: 'Aktivně',
            afk: 'AFK',
            conservative: 'Opatrně',
            night: 'Noc'
        }[profile] || profile;
    }

    function strategyLabel(mode) {
        return {
            efficiency: 'suroviny/h',
            balanced: 'stejný výnos',
            target: 'nejlepší první'
        }[mode] || mode;
    }

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function injectStyles() {
        if (document.querySelector('#tsa-style')) {
            return;
        }
        const style = document.createElement('style');
        style.id = 'tsa-style';
        style.textContent = `
            #tsa-panel {
                position: fixed;
                z-index: 10000;
                top: 88px;
                right: 16px;
                width: 560px;
                max-height: calc(100vh - 110px);
                overflow: auto;
                resize: both;
                box-sizing: border-box;
                padding: 10px;
                border: 1px solid #7d510f;
                background: #f4e4bc;
                color: #2f2314;
                box-shadow: 0 2px 10px rgba(0, 0, 0, .35);
                font-family: Arial, sans-serif;
                font-size: calc(12px * var(--tsa-scale, 1));
                min-width: 330px;
                min-height: 46px;
            }
            #tsa-panel * {
                box-sizing: border-box;
            }
            #tsa-panel.tsa-collapsed {
                resize: none;
                min-height: 0;
                overflow: hidden;
            }
            #tsa-panel.tsa-collapsed .tsa-body {
                display: none;
            }
            #tsa-panel .tsa-head,
            #tsa-panel .tsa-row,
            #tsa-panel .tsa-actions {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 8px;
            }
            #tsa-panel .tsa-head {
                justify-content: space-between;
                gap: 10px;
                margin-bottom: 10px;
                user-select: none;
            }
            #tsa-panel.tsa-collapsed .tsa-head {
                margin-bottom: 0;
            }
            #tsa-panel .tsa-drag-handle {
                cursor: move;
                min-width: 0;
                flex: 1;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            #tsa-panel .tsa-title-main,
            #tsa-panel .tsa-title-status {
                display: inline-block;
                vertical-align: middle;
            }
            #tsa-panel .tsa-title-status {
                margin-left: 8px;
                font-weight: normal;
                opacity: .82;
            }
            #tsa-panel .tsa-head-actions {
                display: flex;
                align-items: center;
                gap: 4px;
                flex: 0 0 auto;
            }
            #tsa-panel .tsa-head-actions button {
                min-width: 24px;
                padding: 2px 6px;
            }
            #tsa-panel .tsa-row span {
                width: 58px;
                flex: 0 0 auto;
            }
            #tsa-panel .tsa-row input[type="range"] {
                flex: 1;
            }
            #tsa-panel .tsa-reserve-output {
                width: 34px;
                text-align: right;
            }
            #tsa-panel .tsa-checkbox-row label {
                flex: 1;
            }
            #tsa-panel .tsa-presets {
                display: flex;
                flex-wrap: wrap;
                gap: 5px;
                margin: 8px 0;
            }
            #tsa-panel .tsa-presets button {
                flex: 1 1 auto;
                min-width: 92px;
            }
            #tsa-panel .tsa-recommendation-box {
                margin: 8px 0;
                padding: 7px;
                border: 1px solid rgba(62, 102, 37, .65);
                background: rgba(114, 150, 70, .22);
                line-height: 1.35;
            }
            #tsa-panel .tsa-recommendation-box span {
                display: block;
                margin-top: 2px;
            }
            #tsa-panel input[type="number"] {
                width: 72px;
            }
            #tsa-panel select {
                flex: 1;
            }
            #tsa-panel button {
                cursor: pointer;
                border: 1px solid #6f4a15;
                background: #d8b36a;
                color: #2f2314;
                padding: 3px 7px;
            }
            #tsa-panel details {
                margin: 6px 0 8px;
            }
            #tsa-panel summary {
                cursor: pointer;
                font-weight: bold;
            }
            #tsa-panel .tsa-troops {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 4px 8px;
                margin-top: 6px;
            }
            #tsa-panel .tsa-troop {
                display: grid;
                grid-template-columns: 18px 1fr 62px;
                align-items: center;
                gap: 4px;
            }
            #tsa-panel .tsa-option {
                display: grid;
                grid-template-columns: 18px 1fr 42px;
                align-items: center;
                gap: 4px;
                margin-top: 4px;
            }
            #tsa-panel .tsa-option em {
                text-align: right;
                font-style: normal;
            }
            #tsa-panel table {
                width: 100%;
                border-collapse: collapse;
                background: rgba(255, 255, 255, .35);
            }
            #tsa-panel th,
            #tsa-panel td {
                border: 1px solid rgba(90, 61, 24, .35);
                padding: 4px;
                vertical-align: top;
            }
            #tsa-panel th {
                background: rgba(120, 80, 30, .18);
            }
            #tsa-panel tr.is-current td {
                background: rgba(96, 128, 44, .18);
                font-weight: bold;
            }
            #tsa-panel .tsa-note {
                margin: 8px 0;
                line-height: 1.35;
            }
            #tsa-panel .tsa-privacy-note {
                padding: 6px;
                border: 1px solid rgba(90, 61, 24, .25);
                background: rgba(255, 255, 255, .22);
            }
            #tsa-panel .tsa-brand {
                margin-top: 10px;
                padding-top: 7px;
                border-top: 1px solid rgba(90, 61, 24, .35);
                opacity: .78;
                line-height: 1.35;
                text-align: right;
            }
            #tsa-panel .tsa-dataset-summary {
                margin: 8px 0;
            }
            #tsa-panel .tsa-metrics {
                display: grid;
                grid-template-columns: repeat(4, minmax(0, 1fr));
                gap: 5px;
                margin: 8px 0;
            }
            #tsa-panel .tsa-metrics div {
                padding: 6px;
                border: 1px solid rgba(90, 61, 24, .28);
                background: rgba(255, 255, 255, .28);
                min-width: 0;
            }
            #tsa-panel .tsa-metrics strong,
            #tsa-panel .tsa-metrics span {
                display: block;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            #tsa-panel .tsa-metrics span {
                opacity: .78;
                margin-top: 2px;
            }
            #tsa-panel .tsa-active-runs,
            #tsa-panel .tsa-next-preview {
                margin: 8px 0;
            }
            #tsa-panel .tsa-active-runs > strong,
            #tsa-panel .tsa-next-preview > strong {
                display: block;
                margin-bottom: 4px;
            }
            #tsa-panel .tsa-next-preview {
                padding: 7px;
                border: 1px solid rgba(62, 102, 37, .55);
                background: rgba(114, 150, 70, .16);
                line-height: 1.35;
            }
            #tsa-panel .tsa-next-preview span {
                display: block;
                margin-top: 3px;
            }
            #tsa-panel .tsa-error {
                margin-top: 8px;
                padding: 8px;
                background: #f5c7be;
                border: 1px solid #9c3d2c;
            }
        `;
        document.head.appendChild(style);
    }

    main();
}());
