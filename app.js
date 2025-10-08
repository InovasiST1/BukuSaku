// app.js

// >>>>>> URL API SUDAH DIGANTI DENGAN YANG ANDA BERIKAN <<<<<<
const API_URL = 'https://script.google.com/macros/s/AKfycbxCcNTjQ3oclK04zIWB883uTVyzdBwyULsRgN07q9HHDaH7udhJs3WQtyCTnagismq5kA/exec'; 

// Elemen DOM
const dataGrid = document.getElementById('data-section');
const filterSelect = document.getElementById('filter-select');
const metadataSelect = document.getElementById('metadata-select');
const metadataTitle = document.getElementById('metadata-title');
const metadataContent = document.getElementById('metadata-content');
const metadataChartContainer = document.getElementById('metadata-chart-container');
const metadataTableContainer = document.getElementById('metadata-table-container');
const navLinks = document.querySelectorAll('nav a, .btn'); 

let allIndicators = []; 
let indicatorMap = {};  
let isGoogleChartsReady = false;
let chartInstances = {}; // Menyimpan instance chart untuk resize

// Pastikan Google Charts dimuat sebelum digunakan
google.charts.setOnLoadCallback(() => {
    isGoogleChartsReady = true;
    // Panggil drawDashboardCharts() setelah data dimuat jika halaman indikator aktif
    if (document.getElementById('view-indikator').classList.contains('active')) {
         drawDashboardCharts();
    }
});


// --- FUNGSI UTILITY: KONVERSI & FORMATTING ---

function safeParseFloat(value) {
    if (typeof value === 'number') return value;
    if (value === null || value === undefined) return 0;
    const strValue = String(value);
    const cleanValue = strValue.replace(',', '.');
    const num = parseFloat(cleanValue);
    return isNaN(num) ? 0 : num;
}

function formatValue(value, decimals = 2) {
    if (value === null || value === undefined) return 'N/A';
    const num = safeParseFloat(value);
    
    // Pembulatan sebelum formatting
    const roundedNum = Math.round(num * Math.pow(10, decimals)) / Math.pow(10, decimals);
    
    // Gunakan toLocaleString untuk pemisah ribuan dan desimal Indonesia
    return roundedNum.toLocaleString('id-ID', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// --- TEXT HELPERS ---
function escapeHtml(unsafe) {
    if (unsafe === null || unsafe === undefined) return '';
    return String(unsafe)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
}

// Convert numbered inline text (e.g. "1. a 2. b 3. c" or lines starting with numbers)
// into an ordered list HTML. Also supports newline-separated items as <ul>.
function toListHTML(text) {
    // Handle null/undefined
    if (text === null || text === undefined) return '<p>Tidak Tersedia.</p>';

    // If the value is already an array, render each item (prefer numbered if items look numbered)
    if (Array.isArray(text)) {
        if (text.length === 0) return '<p>Tidak Tersedia.</p>';
        // If array of primitives, render as UL
        const primitives = text.every(t => (t === null || t === undefined) || (typeof t === 'string' || typeof t === 'number' || typeof t === 'boolean'));
        if (primitives) {
            return '<ul>' + text.map(t => '<li>' + escapeHtml(String(t)) + '</li>').join('') + '</ul>';
        }
        // For mixed/objects, render per item recursively
        return '<div>' + text.map(item => typeof item === 'object' ? toListHTML(item) : '<p>' + escapeHtml(String(item)) + '</p>').join('') + '</div>';
    }

    // If it's an object, try to detect image-like or text-like structure
    if (typeof text === 'object') {
        // Common image property names used by APIs
        const urlKeys = ['url', 'src', 'imageUrl', 'thumbnail', 'link'];
        for (const k of urlKeys) {
            if (text[k] && typeof text[k] === 'string') {
                const safeUrl = escapeHtml(text[k]);
                return `<p><img src="${safeUrl}" alt="image" class="metadata-img"/></p>`;
            }
        }

        // If object has a 'text' or 'content' property, use that
        if (text.text || text.content) {
            return toListHTML(text.text || text.content);
        }

        // Fallback: attempt to stringify useful values (keys with primitive values)
        const primitiveEntries = Object.entries(text).filter(([k, v]) => (v === null || ['string', 'number', 'boolean'].includes(typeof v)));
        if (primitiveEntries.length) {
            return '<ul>' + primitiveEntries.map(([k, v]) => `<li><strong>${escapeHtml(k)}:</strong> ${escapeHtml(String(v))}</li>`).join('') + '</ul>';
        }

        // Last resort: stringify whole object safely
        try {
            return '<pre>' + escapeHtml(JSON.stringify(text, null, 2)) + '</pre>';
        } catch (e) {
            return '<p>Data tidak dapat ditampilkan.</p>';
        }
    }

    // Primitive (string/number)
    let s = String(text).trim();
    if (!s) return '<p>Tidak Tersedia.</p>';

    // Normalize newlines
    s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Count numbered patterns like "1. " or "1) "
    const numberedMatches = s.match(/\d+[\.)]\s+/g) || [];
    if (numberedMatches.length >= 2) {
        // Split on numbers, drop any empty leading
        const parts = s.split(/\d+[\.)]\s+/).map(p => p.trim()).filter(Boolean);
        if (parts.length) {
            return '<ol>' + parts.map(p => '<li>' + escapeHtml(p) + '</li>').join('') + '</ol>';
        }
    }

    // If newline-separated and multiple lines, create unordered list
    const lines = s.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length > 1) {
        return '<ul>' + lines.map(l => '<li>' + escapeHtml(l) + '</li>').join('') + '</ul>';
    }

    // Fallback: single paragraph (preserve single newlines with <br>)
    return '<p>' + escapeHtml(s).replace(/\n/g, '<br>') + '</p>';
}

// --- FUNGSI 1: MENGGANTI TAMPILAN ---
function showView(viewId) {
    document.querySelectorAll('.view-section').forEach(section => {
        section.classList.add('hidden');
    });
    document.getElementById(viewId).classList.remove('hidden');

    // Update Nav Link Status
    document.querySelectorAll('nav a').forEach(link => {
        link.classList.remove('active');
        if (link.dataset.view === viewId) {
            link.classList.add('active');
        }
    });

    // Khusus untuk halaman Indikator, gambar ulang chart jika data sudah ada
    if (viewId === 'view-indikator' && allIndicators.length > 0 && isGoogleChartsReady) {
        drawDashboardCharts();
    }
}

// --- FUNGSI 2: PENGAMBILAN DATA (FETCH) ---
async function fetchData() {
    try {
        dataGrid.innerHTML = '<div class="loading">Memuat data indikator strategis...</div>';

        // Lakukan pengulangan (retry) dengan exponential backoff jika terjadi kegagalan fetch
        const maxRetries = 3;
        let response;
        for (let i = 0; i < maxRetries; i++) {
            try {
                response = await fetch(API_URL);
                if (response.ok) break; // Berhasil, keluar dari loop
            } catch (error) {
                if (i < maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
                } else {
                    throw error; // Lempar error jika retry terakhir gagal
                }
            }
        }

        if (!response.ok) {
            throw new Error(`API error! Status: ${response.status}`);
        }
        
        // Data dari Apps Script adalah Array of Indicator Objects
        const data = await response.json(); 
        
        if (data.error) {
             dataGrid.innerHTML = `<div class="loading" style="color: red;">Error API: ${data.error}. Cek Apps Script logs Anda.</div>`;
             return;
        }

        allIndicators = data;
        indicatorMap = {};
        chartInstances = {}; // Reset instance chart
        
        allIndicators.forEach(item => {
            indicatorMap[item.sheet_name] = item;
        });

        renderIndicatorCards(allIndicators);
        populateFilterDropdown(allIndicators);
        populateMetadataDropdown(allIndicators);

        if (isGoogleChartsReady) {
            drawDashboardCharts();
        }

    } catch (error) {
        console.error("Kesalahan saat mengambil data:", error);
        dataGrid.innerHTML = `<div class="loading" style="color: red;">Gagal memuat data. Cek koneksi internet atau pastikan URL API sudah benar dan dideploy ulang. Pesan: ${error.message}</div>`;
    }
}

// --- FUNGSI 3: MEMBUAT KARTU DASHBOARD ---
function createChartContainer(key) {
    return `<div class="card-chart-container"><div id="chart-${key}" style="width: 100%; height: 100%;"></div></div>`;
}

function createCard(data) {
    const perubahanFloat = safeParseFloat(data.selisih || 0); 
    const nilaiFormatted = formatValue(data.nilai, 2); 
    const indicatorName = data.nama || data.sheet_name;
    const indicatorKey = data.sheet_name;

    const isPositive = perubahanFloat > 0;
    const colorClass = isPositive ? 'green' : (perubahanFloat < 0 ? 'red' : '');
    const arrowChar = isPositive ? '▲' : (perubahanFloat < 0 ? '▼' : '▬');
    
    // Selisih diformat 2 desimal dengan tambahan "vs Tahun Lalu"
    const changeText = `${arrowChar} ${formatValue(Math.abs(perubahanFloat), 2)} vs Tahun Lalu`;

    const chartHtml = createChartContainer(indicatorKey);
    
    // Ambil Insight dari data yang sudah digabungkan
    const insightText = data.insight || data.deskripsi || 'Insight tidak tersedia.';

    return `
        <div class="card" data-indicator-key="${indicatorKey}">
            <h3 class="card-title">${indicatorName} <span style="font-size: 0.8em; color: #777;">(Tahun ${data.tahun || 'N/A'})</span></h3>
            <div class="main-value">
                <span class="value ${colorClass}">${nilaiFormatted}</span>
            </div>
            <p class="change ${colorClass}">${changeText}</p>
            
            ${chartHtml}

            <div class="description">
                <div class="insight-header">
                    <span class="insight-icon">💡</span>
                    <span>Insight Analisis</span>
                </div>
                <div class="insight-text">${insightText}</div>
            </div>
        </div>
    `;
}

// --- FUNGSI 4: MERENDER KARTU ---
function renderIndicatorCards(indicators) {
    dataGrid.innerHTML = '';
    
    if (indicators.length === 0) {
        dataGrid.innerHTML = '<div class="loading">Tidak ada data indikator yang ditemukan. Pastikan data di Spreadsheet dan Apps Script sudah benar.</div>';
        return;
    }

    indicators.forEach(data => {
        dataGrid.innerHTML += createCard(data);
    });
}

// --- FUNGSI 5: MENGGAMBAR CHART DASHBOARD ---
function drawDashboardCharts() {
    if (!isGoogleChartsReady || allIndicators.length === 0) return;
    
    allIndicators.forEach(data => {
        const indicatorKey = data.sheet_name;
        const chartElement = document.getElementById(`chart-${indicatorKey}`);
        
        if (!chartElement) return;
        
        const historyData = data.history || [];
        if (historyData.length <= 1) {
             chartElement.innerHTML = '<div class="no-chart-data">Data historis tidak cukup.</div>';
             return;
        }

        const chartDataArray = [['Tahun', data.nama || indicatorKey]];
        historyData.forEach(item => {
            const value = safeParseFloat(item.nilai);
            const year = safeParseFloat(item.tahun); // pastikan tahun adalah angka untuk charts
            // Karena Google Charts Line Chart lebih baik dengan data string/number di kolom pertama
            const yearLabel = (year % 1 === 0) ? year.toString() : year; 

            if (!isNaN(value)) {
                chartDataArray.push([yearLabel, value]); 
            }
        });
        
        const chartData = google.visualization.arrayToDataTable(chartDataArray);

        const chart = new google.visualization.LineChart(chartElement);
        // Simpan instance chart
        chartInstances[indicatorKey] = { chart, data: chartData };

        const options = {
            vAxis: { 
                title: 'Nilai',
                format: '#,##0.00', 
                textStyle: { fontSize: 10 } 
            },
            hAxis: { 
                title: 'Tahun',
                // Tampilkan label sumbu H hanya pada data points yang ada
                format: '0', 
                textStyle: { fontSize: 10 } 
            },
            legend: { position: 'none' },
            pointSize: 4,
            colors: ['#667eea'], 
            chartArea: { left: 40, top: 10, right: 10, bottom: 30, width: '90%', height: '80%' },
            // >>>>>> TAMBAH OPSI ANIMASI DI SINI <<<<<<
            animation: {
                duration: 1200, // Durasi animasi dalam milidetik (1.2 detik)
                easing: 'out', // Efek animasi: easeOut
                startup: true // Mulai animasi saat chart pertama kali digambar
            }
        };
        chart.draw(chartData, options);
    });
}

// --- FUNGSI 6: FILTER INDIKATOR ---
function populateFilterDropdown(indicators) {
    // Reset dropdown
    filterSelect.innerHTML = '<option value="all">Tampilkan Semua Indikator</option>';
    
    // Tambahkan setiap indikator ke dropdown
    indicators.forEach(item => {
        const option = document.createElement('option');
        option.value = item.sheet_name;
        option.textContent = item.nama || item.sheet_name;
        filterSelect.appendChild(option);
    });
}

function handleFilterChange() {
    applyFilters();
}

function applyFilters() {
    const selectedIndicator = filterSelect.value;
    
    let filteredIndicators = allIndicators;

    // Filter berdasarkan indikator yang dipilih
    if (selectedIndicator !== 'all') {
        filteredIndicators = filteredIndicators.filter(data => {
            return data.sheet_name === selectedIndicator;
        });
    }

    renderIndicatorCards(filteredIndicators);
    if (isGoogleChartsReady) {
        drawDashboardCharts();
    }
}


// --- FUNGSI 7: METADATA DROPDOWN ---
function populateMetadataDropdown(indicators) {
    metadataSelect.innerHTML = '<option value="">Pilih Indikator...</option>'; 
    indicators.forEach(item => {
        const option = document.createElement('option');
        // Kunci di dropdown menggunakan sheet_name
        option.value = item.sheet_name; 
        option.textContent = item.nama || item.sheet_name;
        metadataSelect.appendChild(option);
    });
}

// --- FUNGSI 8: METADATA DETAIL (MEMBACA DATA METADATA LENGKAP) ---
function handleMetadataSelect(event) {
    const indicatorKey = event.target.value; 
    const dataDetail = indicatorMap[indicatorKey]; 
    
    // Sembunyikan Chart Container
    metadataChartContainer.style.display = 'none';
    metadataTableContainer.classList.add('hidden');

    if (dataDetail) { 
        const indicatorName = dataDetail.nama || indicatorKey;
        metadataTitle.textContent = `Metadata: ${indicatorName}`;

        // Konten Metadata Lengkap (gunakan toListHTML untuk memformat numbered / multiline text)
        metadataContent.innerHTML = `
            <h4>Nilai Terkini (${dataDetail.tahun || 'N/A'}):</h4>
            <p style="font-size: 1.2em; font-weight: bold; color: #3f51b5;">${formatValue(dataDetail.nilai, 2)}</p>

            <h4>Penjelasan/Definisi:</h4>
            ${toListHTML(dataDetail.penjelasan || dataDetail.definisi || 'Tidak Tersedia.')}

            <h4>Perhitungan/Metode:</h4>
            ${toListHTML(dataDetail.perhitungan || dataDetail.metode || 'Tidak Tersedia.')}

            <h4>Sumber Indikator:</h4>
            ${toListHTML(dataDetail.sumber_indikator || dataDetail.sumber || 'Tidak Tersedia.')}

            <h4>Interpretasi Data:</h4>
            ${toListHTML(dataDetail.interpretasi_data || 'Tidak Tersedia.')}
        `;
        
        // Tampilkan Tabel Historis
        metadataTableContainer.classList.remove('hidden');
        document.getElementById('table-title').textContent = `Data Historis: ${indicatorName}`;
        renderHistoryTable(dataDetail.history);
        
    } else {
        metadataTitle.textContent = 'Metadata Indikator';
        metadataContent.innerHTML = `Silakan pilih indikator dari *dropdown* di atas untuk melihat detail.`;
    }
}

// --- FUNGSI 9: MERENDER TABEL HISTORIS ---
function renderHistoryTable(historyData) {
    const tableBody = document.getElementById('data-history-table');
    tableBody.innerHTML = ''; 

    if (!historyData || historyData.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="4">Tidak ada data historis yang tersedia.</td></tr>';
        return;
    }

    // Ambil semua header yang ada
    const allKeys = new Set();
    historyData.forEach(item => {
        Object.keys(item).forEach(key => allKeys.add(key));
    });
    
    // Filter dan urutkan header yang ingin ditampilkan
    // Pastikan kunci yang digunakan sesuai dengan Apps Script (lowercase, snake_case)
    const displayKeys = ['nama', 'tahun', 'nilai', 'selisih'].filter(key => allKeys.has(key));

    let headerRow = '<thead><tr>';
    displayKeys.forEach(key => {
        // Kapitalisasi untuk judul kolom
        headerRow += `<th>${key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')}</th>`;
    });
    headerRow += '</tr></thead>';
    tableBody.innerHTML += headerRow;

    let bodyContent = '<tbody>';
    historyData.forEach(item => {
        bodyContent += '<tr>';
        displayKeys.forEach(key => {
            let value = item[key];
            if (key === 'nilai' || key === 'selisih') {
                value = formatValue(value, 2);
            }
            bodyContent += `<td>${value}</td>`;
        });
        bodyContent += '</tr>';
    });
    bodyContent += '</tbody>';
    tableBody.innerHTML += bodyContent;
}

// --- FUNGSI 10: RESPONSIVE CHART ---
function resizeChart() {
    if (!isGoogleChartsReady) return;
    
    // Iterasi melalui semua instance chart yang sudah disimpan
    for (const key in chartInstances) {
        const { chart, data } = chartInstances[key];
        const chartElement = document.getElementById(`chart-${key}`);
        if (chartElement) {
             // Menggambar ulang chart agar menyesuaikan ukuran container yang berubah
            chart.draw(data, {
                 vAxis: { 
                    title: 'Nilai',
                    format: '#,##0.00', 
                    textStyle: { fontSize: 10 } 
                },
                hAxis: { 
                    title: 'Tahun',
                    format: '0', 
                    textStyle: { fontSize: 10 } 
                },
                legend: { position: 'none' },
                pointSize: 4,
                colors: ['#667eea'], 
                chartArea: { left: 40, top: 10, right: 10, bottom: 30, width: '90%', height: '80%' },
                animation: {
                    duration: 1200, 
                    easing: 'out', 
                    startup: true 
                }
            });
        }
    }
}

// --- INITIALIZATION ---
navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const viewId = link.dataset.view;
        if (viewId) {
            showView(viewId);
        }
    });
});

filterSelect.addEventListener('change', handleFilterChange);
metadataSelect.addEventListener('change', handleMetadataSelect);

// Tambahkan event listener untuk resize (membuat chart dinamis)
window.addEventListener('resize', resizeChart);


// Muat data saat aplikasi pertama kali dijalankan
document.addEventListener('DOMContentLoaded', () => {
    fetchData();
    showView('view-home');

});
