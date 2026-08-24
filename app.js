// Universal App State
let appState = {
    activeClassId: "CLASS-11SCI",
    data: {},
    codeReader: null,
    isCameraRunning: false,
    lastScannedCode: "",
    lastScanTime: 0
};

// Hardware USB Scanner Buffer Variables
let barcodeBuffer = "";
let lastKeyTime = 0;

window.addEventListener('DOMContentLoaded', async () => {
    startClock();
    await loadDatabase();
    initClassSelector();
    renderDynamicDashboard();
    initPhysicalScannerListener();
});

// Load Database
async function loadDatabase() {
    try {
        const res = await fetch('data.json');
        appState.data = await res.json();
    } catch (err) {
        console.error("Database loading failed:", err);
    }
}

// Populate & Change Classroom Dropdown
function initClassSelector() {
    const selectEl = document.getElementById('classSelect');
    if (!selectEl || !appState.data.classes) return;

    selectEl.innerHTML = appState.data.classes.map(c => 
        `<option value="${c.id}" ${c.id === appState.activeClassId ? 'selected' : ''}>${c.name}</option>`
    ).join('');

    selectEl.addEventListener('change', (e) => {
        appState.activeClassId = e.target.value;
        renderDynamicDashboard();
    });
}

// Master UI Rendering Engine
function renderDynamicDashboard() {
    const { activeClassId, data } = appState;
    if (!data.classes) return;

    const currentClassObj = data.classes.find(c => c.id === activeClassId);
    if (!currentClassObj) return;

    // Header Updates
    if (document.getElementById('schoolName') && data.schoolInfo) {
        document.getElementById('schoolName').innerText = data.schoolInfo.name;
    }
    if (document.getElementById('globalNoticeText') && data.schoolInfo) {
        document.getElementById('globalNoticeText').innerText = data.schoolInfo.globalNotice;
    }

    // Routine Metrics
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const currentDayName = days[new Date().getDay()];
    const classSchedule = (data.routines[activeClassId] && data.routines[activeClassId][currentDayName]) || [];

    const activePeriod = classSchedule[0];
    const nextPeriod = classSchedule[1] || { subject: "End of Day", teacherId: "" };

    if (!activePeriod) {
        document.getElementById('currentSubject').innerText = "No Scheduled Classes";
        document.getElementById('currentTopic').innerText = "Free period or weekend";
        document.getElementById('teacherName').innerText = "N/A";
        return;
    }

    const assignedTeacher = data.teachers.find(t => t.id === activePeriod.teacherId);
    const nextTeacher = data.teachers.find(t => t.id === nextPeriod.teacherId);

    document.getElementById('periodBadge').innerText = `PERIOD ${activePeriod.period} (${activePeriod.time})`;
    document.getElementById('currentSubject').innerText = activePeriod.subject;
    document.getElementById('currentTopic').innerText = `Topic: ${activePeriod.topic}`;
    document.getElementById('teacherName').innerText = assignedTeacher ? assignedTeacher.name : "Unassigned";

    if (document.getElementById('nextSubject')) {
        document.getElementById('nextSubject').innerText = nextPeriod.subject;
    }
    if (document.getElementById('nextTeacher')) {
        document.getElementById('nextTeacher').innerText = nextTeacher ? `(${nextTeacher.name})` : '';
    }

    // Substitution Alerts
    const subRule = data.substitutions.find(s => s.classId === activeClassId && s.period === activePeriod.period);
    const subBanner = document.getElementById('substitutionAlert');
    
    if (subRule && subBanner) {
        const subTeacher = data.teachers.find(t => t.id === subRule.substituteTeacherId);
        const origTeacher = data.teachers.find(t => t.id === subRule.originalTeacherId);
        
        subBanner.classList.remove('hidden');
        document.getElementById('subDetails').innerText = `${subTeacher ? subTeacher.name : 'Proxy'} covering for ${origTeacher ? origTeacher.name : 'Teacher'} (${subRule.note})`;
        document.getElementById('teacherName').innerText = `${subTeacher ? subTeacher.name : 'Proxy'} (Substitute)`;
    } else if (subBanner) {
        subBanner.classList.add('hidden');
    }
}

// Optical Camera Scanner (ZXing JS)
async function startCamera() {
    const hints = new Map();
    const enabledFormats = [
        ZXing.BarcodeFormat.CODE_128,
        ZXing.BarcodeFormat.CODE_39,
        ZXing.BarcodeFormat.EAN_13
    ];
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, enabledFormats);

    appState.codeReader = new ZXing.BrowserMultiFormatReader(hints);

    try {
        const constraints = {
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "environment" }
        };

        appState.codeReader.decodeFromConstraints(constraints, 'webcamPreview', (result, err) => {
            if (result) {
                const code = result.getText();
                const now = Date.now();
                if (code !== appState.lastScannedCode || (now - appState.lastScanTime) > 3000) {
                    appState.lastScannedCode = code;
                    appState.lastScanTime = now;
                    registerAttendance(code);
                }
            }
        });

        appState.isCameraRunning = true;
        const btn = document.getElementById('cameraToggleBtn');
        if (btn) {
            btn.innerHTML = `<i class="fa-solid fa-stop"></i> Stop Camera`;
            btn.className = "btn btn-red";
        }
    } catch (error) {
        console.error("Camera Error:", error);
        alert("Camera permission denied or non-HTTPS environment.");
    }
}

function stopCamera() {
    if (appState.codeReader) {
        appState.codeReader.reset();
        appState.isCameraRunning = false;
        const btn = document.getElementById('cameraToggleBtn');
        if (btn) {
            btn.innerHTML = `<i class="fa-solid fa-power-off"></i> Start Camera`;
            btn.className = "btn btn-green";
        }
    }
}

function toggleCamera() {
    if (appState.isCameraRunning) {
        stopCamera();
    } else {
        startCamera();
    }
}

// Hardware USB Scanner Listener
function initPhysicalScannerListener() {
    window.addEventListener('keydown', (e) => {
        const currentTime = Date.now();
        if (currentTime - lastKeyTime > 100) {
            barcodeBuffer = "";
        }
        lastKeyTime = currentTime;

        if (e.key === 'Enter') {
            if (barcodeBuffer.length >= 4) {
                registerAttendance(barcodeBuffer.trim());
                barcodeBuffer = "";
            }
        } else if (e.key.length === 1) {
            barcodeBuffer += e.key;
        }
    });
}

// Log Attendance
function registerAttendance(barcodeVal) {
    const student = appState.data.students.find(s => s.barcode === barcodeVal);
    const list = document.getElementById('attendanceList');
    
    if (!list) return;
    if (list.querySelector('.empty-log')) list.innerHTML = '';

    if (student) {
        playAudioTone(800, 150);
        const item = document.createElement('li');
        item.innerHTML = `<div><strong>${student.name}</strong><br><small style="color:#94a3b8">${student.classId}</small></div> <span style="color:#10b981">PRESENT</span>`;
        list.prepend(item);
    } else {
        playAudioTone(300, 400);
        alert(`Unrecognized Barcode: "${barcodeVal}"`);
    }
}

// Audio Cue Synthesizer
function playAudioTone(freq, duration) {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        setTimeout(() => { osc.stop(); ctx.close(); }, duration);
    } catch (e) {
        console.warn("Audio Context blocked.");
    }
}

// Real-Time Clock
function startClock() {
    setInterval(() => {
        const now = new Date();
        const clockEl = document.getElementById('clock');
        const dayEl = document.getElementById('currentDay');
        if (clockEl) clockEl.innerText = now.toLocaleTimeString();
        if (dayEl) {
            const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            dayEl.innerText = `${days[now.getDay()]}, ${now.toLocaleDateString()}`;
        }
    }, 1000);
}