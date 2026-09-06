const dayEndState = { records: [], selected: new Map(), limit: 50, busy: false, request: 0 };

function dayEndKey(code, platform) {
    return `${platformAnahtari(platform)}:${siparisKodunuNormalizeEt(code)}`;
}

async function dayEndRequest(url, options = {}) {
    const response = await fetch(url, { cache: 'no-store', ...options });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Eksik sipariş işlemi tamamlanamadı.');
    return data;
}

function dayEndMessage(message, error = false) {
    const target = document.getElementById('dayEndMessage');
    if (!target) return;
    target.textContent = message;
    target.classList.toggle('error', error);
}

async function gunSonuEksikleriGoster() {
    scannerDurdur();
    aktifSekme = 'issues';
    searchInput.disabled = true;
    document.body.classList.remove('detailMode', 'locationMode', 'shipmentMode', 'adminMode', 'historyMode');
    document.body.classList.add('issueMode');
    sekmeDurumuGuncelle();
    dayEndState.selected.clear();
    dayEndState.limit = 50;
    const request = ++dayEndState.request;
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(new Date());
    result.innerHTML = `
        <section class="issueTool dayEndTool" id="dayEndTool">
            <div class="locationHeader">
                <div><p class="eyebrow">Gün Sonu</p><h2>Eksik Siparişler</h2></div>
                <button type="button" data-day-end-legacy>Önceki Ürün Kayıtları</button>
            </div>
            <div id="dayEndMessage" role="status" aria-live="polite">Kayıtlar yükleniyor...</div>
            <details id="dayEndAdd">
                <summary>+ Eksik Sipariş Ekle</summary>
                <form id="dayEndForm">
                    <div class="dayEndFilters">
                        <label>Gün sonu tarihi<input type="date" id="dayEndDate" value="${today}" required></label>
                        <label>Platform<select id="dayEndAddPlatform"><option value="">Tümü</option><option value="zoombutik">Zoombutik</option><option value="trendyol">Trendyol</option></select></label>
                        <label class="dayEndSearch">Sipariş ara<input type="search" id="dayEndOrderSearch" placeholder="Müşteri adı veya sipariş no" autocomplete="off"></label>
                    </div>
                    <div class="dayEndActions">
                        <button type="button" data-day-end-select>Görünenleri Seç</button>
                        <button type="button" data-day-end-clear>Seçimi Temizle</button>
                        <span id="dayEndSelected">0 sipariş seçildi</span>
                    </div>
                    <div id="dayEndCandidates"></div>
                    <button type="button" id="dayEndMore" data-day-end-more hidden>Daha Fazla Göster</button>
                    <label>Eksik ürün / açıklama<textarea id="dayEndNote" maxlength="1000" rows="2" placeholder="Örnek: Siyah elbise, L beden, 1 adet eksik"></textarea></label>
                    <button type="submit" class="issueSaveButton" id="dayEndSave" disabled>Seçilenleri Eksik Listesine Ekle</button>
                </form>
            </details>
            <div class="dayEndFilters">
                <label class="dayEndSearch">Kayıtlarda ara<input type="search" id="dayEndRecordSearch" placeholder="Müşteri, sipariş no veya not"></label>
                <label>Platform<select id="dayEndPlatform"><option value="">Tümü</option><option value="zoombutik">Zoombutik</option><option value="trendyol">Trendyol</option></select></label>
                <label>Durum<select id="dayEndStatus"><option value="open">Eksik Bekleyenler</option><option value="resolved">Eksikliği Giderilenler</option><option value="">Tümü</option></select></label>
                <label>Başlangıç tarihi<input type="date" id="dayEndFrom"></label>
                <label>Bitiş tarihi<input type="date" id="dayEndTo"></label>
            </div>
            <div class="sectionTitle"><h3>Gün Sonu Listesi</h3><span id="dayEndCount"></span></div>
            <div id="dayEndRecords"></div>
        </section>`;
    try {
        const data = await dayEndRequest('/issues/day-end');
        if (request !== dayEndState.request || !document.getElementById('dayEndTool')) return;
        dayEndState.records = data.result;
        dayEndRenderRecords();
        dayEndRenderCandidates();
        dayEndMessage('');
    } catch (error) {
        dayEndMessage(error.message, true);
    }
}

function dayEndCandidates() {
    const query = aramaNormalize(document.getElementById('dayEndOrderSearch').value);
    const platform = document.getElementById('dayEndAddPlatform').value;
    const open = new Set(dayEndState.records.filter(r => r.status === 'open').map(r => dayEndKey(r.order_code, r.platform)));
    const unique = new Map();
    for (const order of siparisler) {
        const code = siparisKodu(order);
        const key = dayEndKey(code, platformAdi(order));
        if (!code || code === '-' || open.has(key) || order.localWorkflowStage === 'shipped' || yereldeKargolanmisMi(order)
            || String(alanOku(order, ['order.status', 'status'], '')) === '6') continue;
        if (platform && platformAnahtari(platformAdi(order)) !== platform) continue;
        if (query && !aramaNormalize(`${code} ${musteriAdi(order)}`).includes(query)) continue;
        unique.set(key, { orderCode: code, customerName: musteriAdi(order), platform: platformEtiketi(platformAnahtari(platformAdi(order))) });
    }
    return [...unique.entries()];
}

function dayEndRenderCandidates() {
    const candidates = dayEndCandidates();
    document.getElementById('dayEndCandidates').innerHTML = candidates.slice(0, dayEndState.limit).map(([key, order]) => `
        <label class="dayEndCandidate">
            <input type="checkbox" data-day-end-order="${temizle(key)}" ${dayEndState.selected.has(key) ? 'checked' : ''}>
            <span><strong>${temizle(order.customerName)}</strong><small>${temizle(order.orderCode)} · ${temizle(order.platform)}</small></span>
        </label>`).join('') || '<p class="shortageEmpty">Eklenebilecek sipariş bulunamadı.</p>';
    document.getElementById('dayEndMore').hidden = candidates.length <= dayEndState.limit;
    dayEndSelectionUpdate();
}

function dayEndSelectionUpdate() {
    document.getElementById('dayEndSelected').textContent = `${dayEndState.selected.size} sipariş seçildi`;
    document.getElementById('dayEndSave').disabled = dayEndState.busy || !dayEndState.selected.size;
}

function dayEndRenderRecords() {
    const query = aramaNormalize(document.getElementById('dayEndRecordSearch').value);
    const platform = document.getElementById('dayEndPlatform').value;
    const status = document.getElementById('dayEndStatus').value;
    const from = document.getElementById('dayEndFrom').value;
    const to = document.getElementById('dayEndTo').value;
    if (from && to && from > to) {
        document.getElementById('dayEndRecords').textContent = 'Bitiş tarihi başlangıç tarihinden önce olamaz.';
        document.getElementById('dayEndCount').textContent = '';
        return;
    }
    const records = dayEndState.records.filter(r => (!status || r.status === status)
        && (!platform || platformAnahtari(r.platform) === platform)
        && (!from || r.work_date >= from) && (!to || r.work_date <= to)
        && (!query || aramaNormalize(`${r.order_code} ${r.customer_name} ${r.note}`).includes(query)));
    document.getElementById('dayEndCount').textContent = `${records.length} sipariş`;
    document.getElementById('dayEndRecords').innerHTML = records.map(r => `
        <article class="issueOrderCard dayEndRecord">
            <div class="issueOrderHeader"><div><h3>${temizle(r.customer_name)}</h3>
                <p>${temizle(r.order_code)} · ${temizle(r.platform)}</p></div>
                <strong>${r.status === 'open' ? 'Eksik Bekliyor' : 'Eksikliği Giderildi'}</strong></div>
            <p>Gün sonu: ${temizle(r.work_date.split('-').reverse().join('.'))}</p>
            <p class="dayEndNote">${temizle(r.note || 'Not eklenmedi.')}</p>
            <small>Ekleyen: ${temizle(r.created_by_name)} · ${temizle(tarihSaatGoster(r.created_at))}</small>
            ${r.resolved_at ? `<small>Eksikliği kapatan: ${temizle(r.resolved_by_name)} · ${temizle(tarihSaatGoster(r.resolved_at))}</small>` : ''}
            ${r.status === 'open' ? `<div class="dayEndActions"><button type="button" data-day-end-edit="${r.id}">Notu Düzenle</button>
                <button type="button" data-day-end-resolve="${r.id}">Eksikliği Giderildi</button></div>` : ''}
        </article>`).join('') || '<p class="shortageEmpty">Bu filtrelere uygun eksik sipariş kaydı yok.</p>';
}

document.addEventListener('input', event => {
    if (['dayEndOrderSearch', 'dayEndAddPlatform'].includes(event.target.id)) {
        dayEndState.limit = 50;
        dayEndRenderCandidates();
    }
    if (['dayEndRecordSearch', 'dayEndPlatform', 'dayEndStatus', 'dayEndFrom', 'dayEndTo'].includes(event.target.id)) dayEndRenderRecords();
});

document.addEventListener('change', event => {
    const key = event.target.dataset.dayEndOrder;
    if (!key) return;
    const candidate = dayEndCandidates().find(([k]) => k === key);
    if (event.target.checked && candidate && dayEndState.selected.size < 200) dayEndState.selected.set(key, candidate[1]);
    else {
        dayEndState.selected.delete(key);
        event.target.checked = false;
        if (dayEndState.selected.size >= 200) dayEndMessage('Bir işlemde en fazla 200 sipariş ekleyebilirsiniz.', true);
    }
    dayEndSelectionUpdate();
});

document.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-day-end-legacy')) { await oncekiEksikUrunKayitlariGoster(); return; }
    if (button.hasAttribute('data-day-end-back')) { await gunSonuEksikleriGoster(); return; }
    if (!button.closest('#dayEndTool') || dayEndState.busy) return;
    if (button.hasAttribute('data-day-end-more')) { dayEndState.limit += 50; dayEndRenderCandidates(); }
    if (button.hasAttribute('data-day-end-clear')) { dayEndState.selected.clear(); dayEndRenderCandidates(); }
    if (button.hasAttribute('data-day-end-select')) {
        for (const [key, order] of dayEndCandidates().slice(0, dayEndState.limit)) {
            if (dayEndState.selected.size >= 200) break;
            dayEndState.selected.set(key, order);
        }
        dayEndRenderCandidates();
    }
    const id = button.dataset.dayEndResolve || button.dataset.dayEndEdit;
    if (!id) return;
    const record = dayEndState.records.find(r => String(r.id) === id);
    const note = button.dataset.dayEndEdit ? prompt('Eksik ürün / açıklama', record.note) : undefined;
    if (note === null) return;
    dayEndState.busy = true;
    button.disabled = true;
    try {
        await dayEndRequest(`/issues/day-end/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: note === undefined ? 'resolve' : 'edit', note }) });
        dayEndState.records = (await dayEndRequest('/issues/day-end')).result;
        if (document.getElementById('dayEndTool')) { dayEndRenderRecords(); dayEndRenderCandidates(); dayEndMessage('Eksik kaydı güncellendi.'); }
    } catch (error) { dayEndMessage(error.message, true); }
    finally {
        dayEndState.busy = false;
        button.disabled = false;
        if (document.getElementById('dayEndTool')) dayEndSelectionUpdate();
    }
});

document.addEventListener('submit', async event => {
    if (event.target.id !== 'dayEndForm') return;
    event.preventDefault();
    if (dayEndState.busy || !dayEndState.selected.size) return;
    dayEndState.busy = true;
    dayEndSelectionUpdate();
    try {
        const data = await dayEndRequest('/issues/day-end', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orders: [...dayEndState.selected.values()], workDate: document.getElementById('dayEndDate').value,
                note: document.getElementById('dayEndNote').value }) });
        dayEndState.selected.clear();
        dayEndState.records = (await dayEndRequest('/issues/day-end')).result;
        if (document.getElementById('dayEndTool')) {
            document.getElementById('dayEndNote').value = '';
            document.getElementById('dayEndStatus').value = 'open';
            dayEndRenderRecords(); dayEndRenderCandidates();
            dayEndMessage(`${data.added} sipariş eksik listesine eklendi.${data.skipped ? ` ${data.skipped} sipariş zaten listede.` : ''}`);
        }
    } catch (error) { dayEndMessage(error.message, true); }
    finally { dayEndState.busy = false; if (document.getElementById('dayEndTool')) dayEndSelectionUpdate(); }
});
