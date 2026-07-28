// ============================================================
// Supabase 連線設定
// 請將以下兩個值換成你自己 Supabase 專案的 Project URL 與 anon public key
// (Supabase Dashboard → Project Settings → API)
// ============================================================
const SUPABASE_URL = 'https://ifggswbwqeanhlhhcbli.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlmZ2dzd2J3cWVhbmhsaGhjYmxpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3NTU1MDQsImV4cCI6MjEwMDMzMTUwNH0.JYPzcC5t3is4PRdXU42E3iEeoXGiKKV8pRR3zCS4t_g';

// persistSession 設為 true：登入取得的 JWT（access token / refresh token）會存在
// localStorage，重新整理頁面仍維持登入狀態，並由 SDK 自動續期。
// supabase-js 會自動把 access token（JWT）放進每個請求的 Authorization 標頭，
// 資料庫端則以 RLS 政策與 RPC 函式中的 auth.uid() 驗證身分。
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: 'roomilly-auth'
    }
});

// App state variables
let rooms = [];               // 畫面用的房間資料（資料庫資料 + 尚未上傳的預設房）
let dbRoomIds = new Set();    // 資料庫中「實際存在」的房號，用來判斷還缺哪幾間
let currentView = 'guest';    // 'guest' or 'admin'
let currentTypeFilter = 'All';
let pendingBookingRoom = null;
let myBookedRooms = [];       // 目前登入旅客在資料庫中的訂房清單
let currentUser = null;       // 目前登入的使用者（null = 未登入）
let isAdminAuthed = false;    // 目前是否已通過員工身分驗證
let guestAuthMode = 'login';  // 會員視窗模式：'login' or 'signup'
let realtimeChannel = null;
const DEFAULT_ROOM_COUNT = 30;

// ============================================================
// 房間照片：每間房一張不同的圖
//
// 30 張 Unsplash 旅宿照片，全部已確認：
//   1) 網址有效（HTTP 200）
//   2) 為橫式構圖（寬高比 > 1.3）—— 直式照片在卡片會被裁掉大半，
//      在燈箱也會出現左右黑邊，因此不納入
// 剛好對應旅館的 30 間房，房號與照片是一對一，不會重複。
// ============================================================
const ROOM_IMAGE_POOL = [
    '1590490360182-c33d57733427', '1598928506311-c55ded91a20c', '1566665797739-1674de7a421a',
    '1631049307264-da0ec9d70304', '1611892440504-42a792e24d32', '1582719478250-c89cae4dc85b',
    '1578683010236-d716f9a3f461', '1560448204-e02f11c3d0e2', '1522771739844-6a9f6d5f14af',
    '1618773928121-c32242e63f39', '1587985064135-0366536eab42', '1584132967334-10e028bd69f7',
    '1595576508898-0ad5c879a061', '1600210492486-724fe5c67fb0', '1616486338812-3dadae4b4ace',
    '1505693416388-ac5ce068fe85', '1540518614846-7eded433c457', '1567767292278-a4f21aa2d36e',
    '1512918728675-ed5a9ecdebfd', '1613490493576-7fde63acd811', '1493809842364-78817add7ffb',
    '1445019980597-93fa8acb246c', '1551882547-ff40c63fe5fa', '1560185007-cde436f6a4d0',
    '1600607687939-ce8a6c25118c', '1600566753086-00f18fb6b3ea', '1618221195710-dd6b41faaea6',
    '1502672260266-1c1ef2d93688', '1596394516093-501ba68a0ba6', '1626178793926-22b28830aa30'
];

// 由房號推出固定的圖片索引。
// 標準房號（101~310）依「樓層 × 房序」對應 0~29，30 間房剛好各拿到不同的一張；
// 員工自訂的房號則用字串雜湊，同一房號每次都會得到同一張圖（不會每次重繪就換圖）。
function roomImageIndex(roomId) {
    const match = /^(\d)(\d{2})$/.exec(String(roomId));
    if (match) {
        const floor = parseInt(match[1], 10);
        const seq = parseInt(match[2], 10);
        if (floor >= 1 && seq >= 1 && seq <= 10) {
            return ((floor - 1) * 10 + (seq - 1)) % ROOM_IMAGE_POOL.length;
        }
    }

    let hash = 0;
    for (const ch of String(roomId)) {
        hash = (hash * 31 + ch.charCodeAt(0)) % 1000000;
    }
    return hash % ROOM_IMAGE_POOL.length;
}

// size: 'card' 卡片縮圖 / 'full' 燈箱大圖
function getRoomImage(roomId, size = 'card') {
    const photoId = ROOM_IMAGE_POOL[roomImageIndex(roomId)];
    const params = size === 'full'
        ? 'auto=format&fit=crop&w=1400&q=85'
        : 'auto=format&fit=crop&w=500&h=320&q=80';
    return `https://images.unsplash.com/photo-${photoId}?${params}`;
}

function generateDefaultRooms() {
    const floorConfigs = [
        { floor: 1, label: '豪華', split: [4, 4, 2] },
        { floor: 2, label: '舒適', split: [3, 5, 2] },
        { floor: 3, label: '尊榮', split: [2, 5, 3] }
    ];

    const roomTypeByIndex = (floorIndex, index) => {
        const [singleCount, doubleCount, familyCount] = floorConfigs[floorIndex].split;
        if (index < singleCount) return 'Single';
        if (index < singleCount + doubleCount) return 'Double';
        return 'Family';
    };

    return floorConfigs.flatMap((config, floorIndex) => {
        return Array.from({ length: 10 }, (_, roomIndex) => {
            const roomNumber = `${config.floor}${String(roomIndex + 1).padStart(2, '0')}`;
            const type = roomTypeByIndex(floorIndex, roomIndex);
            const roomNames = {
                Single: `${config.label}單人雅緻房`,
                Double: `${config.label}雙人精緻房`,
                Family: `${config.label}家庭尊榮房`
            };
            const price = type === 'Single' ? 1500 : type === 'Double' ? 2500 : 4000;
            const tags = type === 'Family' ? ['大空間', '家庭專屬'] : ['免費WiFi', '含早餐'];

            return {
                id: roomNumber,
                name: `${roomNames[type]} ${roomNumber}`,
                type,
                price,
                status: 'vacant',
                tags,
                occupant: '',
                checkinDate: '',
                checkoutDate: '',
                bookedBy: null
            };
        });
    });
}

function mergeRoomsWithDefaults(dbRooms) {
    const defaultRooms = generateDefaultRooms();
    const dbMap = new Map(dbRooms.map(r => [r.id, r]));

    const merged = defaultRooms.map(def => dbMap.get(def.id) || def);
    dbRooms.forEach(room => {
        if (!merged.some(r => r.id === room.id)) {
            merged.push(room);
        }
    });

    return merged;
}

// 把「資料庫裡還沒有」的預設房間補上去（僅員工可執行，寫入受 RLS 保護）
//
// 注意：這裡必須比對 dbRoomIds（資料庫實際存在的房號），不能比對 rooms。
// rooms 是 mergeRoomsWithDefaults() 的結果，永遠包含全部 30 間預設房，
// 拿它來比對會永遠算出「零間缺少」而什麼都不做。
async function syncDefaultRoomsToSupabase() {
    const defaultRooms = generateDefaultRooms();
    const missingRooms = defaultRooms.filter(r => !dbRoomIds.has(r.id));

    if (missingRooms.length === 0) return;

    const insertPayload = missingRooms.map(room => ({
        id: room.id,
        name: room.name,
        type: room.type,
        price: room.price,
        status: room.status,
        tags: room.tags,
        occupant: room.occupant,
        checkin_date: null,
        checkout_date: null
    }));

    // upsert + ignoreDuplicates：若同時有其他人也在補齊，重複的房號會被忽略而非報錯
    const { error } = await supabaseClient
        .from('rooms')
        .upsert(insertPayload, { onConflict: 'id', ignoreDuplicates: true });

    if (error) {
        showToast('⚠️ 自動同步房間至 Supabase 失敗：' + error.message);
        return;
    }

    showToast(`✨ 已自動補齊 ${missingRooms.length} 間預設房間到 Supabase。`);
    await loadRooms();
}

// 後台「同步房間」按鈕：手動觸發，並在已經同步完成時也給明確回饋
async function manualSyncRooms() {
    if (!isAdminAuthed) {
        showToast('⚠️ 請先以員工帳號登入');
        return;
    }

    const btn = document.getElementById('btn-sync-rooms');
    const missingCount = generateDefaultRooms().filter(r => !dbRoomIds.has(r.id)).length;

    if (missingCount === 0) {
        showToast(`✅ 全部 ${dbRoomIds.size} 間房間都已在 Supabase 上，無需同步。`);
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>同步中...</span>';

    await syncDefaultRoomsToSupabase();

    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i><span>同步房間</span>';
}

// Setup Dates default inputs to current date + initial data load
window.onload = async function() {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    document.getElementById('filter-checkin').value = today.toISOString().split('T')[0];
    document.getElementById('filter-checkout').value = tomorrow.toISOString().split('T')[0];

    // 還原既有的 JWT session（若 localStorage 內的權杖仍有效）
    await restoreSession();

    await loadRooms();
    subscribeRealtime();

    // 權杖狀態變動（登入 / 登出 / 自動續期 / 其他分頁登出）時同步畫面。
    // 註：callback 內不可直接 await supabase 的方法（會與 auth lock 互鎖），
    //     因此後續動作一律丟到 setTimeout 排到下一個 tick 執行。
    supabaseClient.auth.onAuthStateChange((event, session) => {
        if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') return;

        const nextUser = session?.user || null;
        const changed = (nextUser?.id || null) !== (currentUser?.id || null);

        currentUser = nextUser;
        if (!currentUser) {
            isAdminAuthed = false;
            myBookedRooms = [];
        }

        refreshAuthUI();
        if (changed) setTimeout(() => { loadRooms(); }, 0);
    });
}

// 讀取目前的 JWT session，還原登入狀態
async function restoreSession() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    currentUser = session?.user || null;

    if (currentUser) {
        isAdminAuthed = await checkIsStaff();
    } else {
        isAdminAuthed = false;
    }

    refreshAuthUI();
}

// 向資料庫確認目前登入者是否為員工（員工名單存於 staff 資料表，前端無法偽造）
async function checkIsStaff() {
    const { data, error } = await supabaseClient.rpc('is_staff');

    if (error) {
        // 找不到函式 = 尚未執行 schema.sql。此時一律視為「非員工」（fail closed）
        console.warn('[Roomilly] is_staff() 檢查失敗：', error.message);
        return false;
    }

    return data === true;
}

// ============================================================
// Supabase 資料存取
// ============================================================

// 從 Supabase 讀取所有房間資料
async function loadRooms() {
    const { data, error } = await supabaseClient
        .from('rooms')
        .select('*')
        .order('id', { ascending: true });

    if (error) {
        showToast('⚠️ 讀取房間資料失敗：' + error.message);
        return;
    }

    const dbRooms = (data || []).map(r => ({
        id: r.id,
        name: r.name,
        type: r.type,
        price: r.price,
        status: r.status,
        tags: r.tags || [],
        occupant: r.occupant || '',
        checkinDate: r.checkin_date || '',
        checkoutDate: r.checkout_date || '',
        bookedBy: r.booked_by || null
    }));

    dbRoomIds = new Set(dbRooms.map(r => r.id));
    rooms = mergeRoomsWithDefaults(dbRooms);

    syncMyBookings();
    renderRooms();
    updateSummaryCounters();
    updateCartUI();
}

// 依目前登入者的 uid，從房間資料中還原「我的預訂」清單
function syncMyBookings() {
    if (!currentUser) {
        myBookedRooms = [];
        return;
    }

    myBookedRooms = rooms
        .filter(room => room.status === 'booked' && room.bookedBy === currentUser.id)
        .map(room => ({
            id: room.id,
            name: room.name,
            price: room.price,
            checkin: room.checkinDate,
            checkout: room.checkoutDate
        }));
}

// 訂閱 rooms 資料表的即時異動（其他分頁 / 使用者的操作會自動同步）
// 需先在 Supabase Dashboard → Database → Replication 開啟 rooms 資料表的 Realtime
function subscribeRealtime() {
    if (realtimeChannel) return;

    realtimeChannel = supabaseClient
        .channel('rooms-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => {
            loadRooms();
        })
        .subscribe();
}

// ============================================================
// 旅客會員登入 / 註冊 / 登出 (Supabase Auth，JWT)
// ============================================================

// 開啟會員視窗（login / signup）
function openGuestAuthModal(mode = 'login') {
    switchGuestAuthTab(mode);
    openModal('guest-auth-modal');
    setTimeout(() => document.getElementById('guest-auth-email').focus(), 150);
}

// 切換「登入 / 註冊」分頁
function switchGuestAuthTab(mode) {
    guestAuthMode = mode;

    const tabLogin = document.getElementById('guest-tab-login');
    const tabSignup = document.getElementById('guest-tab-signup');
    const activeCls = "flex-1 py-2 rounded-xl text-xs font-bold transition-all bg-white text-brand-600 shadow-sm";
    const idleCls = "flex-1 py-2 rounded-xl text-xs font-bold transition-all text-slate-500 hover:text-slate-800";

    tabLogin.className = mode === 'login' ? activeCls : idleCls;
    tabSignup.className = mode === 'signup' ? activeCls : idleCls;

    document.getElementById('guest-auth-title').innerText = mode === 'login' ? '旅客會員登入' : '註冊旅客會員';
    document.getElementById('guest-auth-subtitle').innerText = mode === 'login'
        ? '登入後即可線上預訂客房並查看您的訂房紀錄'
        : '建立帳號只需信箱與密碼，馬上就能開始訂房';
    document.getElementById('guest-auth-submit').innerText = mode === 'login' ? '登入' : '註冊';
    document.getElementById('guest-auth-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';

    document.getElementById('guest-auth-name-wrap').classList.toggle('hidden', mode !== 'signup');
    document.getElementById('guest-auth-password-hint').classList.toggle('hidden', mode !== 'signup');

    clearGuestAuthMessages();
}

function clearGuestAuthMessages() {
    document.getElementById('guest-auth-error').classList.add('hidden');
    document.getElementById('guest-auth-success').classList.add('hidden');
}

function showGuestAuthError(msg) {
    const el = document.getElementById('guest-auth-error');
    el.innerText = msg;
    el.classList.remove('hidden');
    document.getElementById('guest-auth-success').classList.add('hidden');
}

function showGuestAuthSuccess(msg) {
    const el = document.getElementById('guest-auth-success');
    el.innerText = msg;
    el.classList.remove('hidden');
    document.getElementById('guest-auth-error').classList.add('hidden');
}

// 送出會員登入 / 註冊
async function submitGuestAuth() {
    const email = document.getElementById('guest-auth-email').value.trim();
    const password = document.getElementById('guest-auth-password').value;
    const displayName = document.getElementById('guest-auth-name').value.trim();
    const submitBtn = document.getElementById('guest-auth-submit');

    clearGuestAuthMessages();

    if (!email || !password) {
        showGuestAuthError('請輸入電子信箱與密碼');
        return;
    }

    if (guestAuthMode === 'signup' && password.length < 6) {
        showGuestAuthError('密碼至少需要 6 個字元');
        return;
    }

    submitBtn.disabled = true;
    submitBtn.innerText = guestAuthMode === 'login' ? '登入中...' : '註冊中...';

    try {
        if (guestAuthMode === 'login') {
            const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (error) {
                showGuestAuthError('登入失敗：' + translateAuthError(error.message));
                return;
            }
            await onGuestSignedIn(data.user);
        } else {
            const { data, error } = await supabaseClient.auth.signUp({
                email,
                password,
                options: { data: { display_name: displayName || email.split('@')[0] } }
            });
            if (error) {
                showGuestAuthError('註冊失敗：' + translateAuthError(error.message));
                return;
            }

            // 專案若開啟「Confirm email」，註冊後不會直接拿到 session，需先收信驗證
            if (!data.session) {
                showGuestAuthSuccess('註冊成功！請至信箱點擊驗證連結後，再回來登入。');
                return;
            }

            await onGuestSignedIn(data.user);
        }
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = guestAuthMode === 'login' ? '登入' : '註冊';
    }
}

// 登入成功後的共用流程
async function onGuestSignedIn(user) {
    currentUser = user;
    isAdminAuthed = await checkIsStaff();

    document.getElementById('guest-auth-email').value = '';
    document.getElementById('guest-auth-password').value = '';
    document.getElementById('guest-auth-name').value = '';

    closeModal('guest-auth-modal');
    refreshAuthUI();
    await loadRooms();

    showToast(`👋 歡迎回來，${getUserDisplayName()}！`);

    // 若登入前正想預訂某間房，登入後直接接續開啟預訂視窗
    if (pendingBookingRoom) {
        const roomId = pendingBookingRoom.id;
        pendingBookingRoom = null;
        openBookingModal(roomId);
    }
}

// 登出（同時清除 localStorage 內的 JWT）
async function guestLogout() {
    await supabaseClient.auth.signOut();
    currentUser = null;
    isAdminAuthed = false;
    myBookedRooms = [];

    if (currentView === 'admin') {
        await switchView('guest');
    }

    refreshAuthUI();
    await loadRooms();
    showToast('已登出，期待您再次光臨 👋');
}

// 取得顯示用名稱
function getUserDisplayName() {
    if (!currentUser) return '訪客';
    return currentUser.user_metadata?.display_name || currentUser.email?.split('@')[0] || '旅客';
}

// 依登入狀態更新頁首與側邊欄 UI
function refreshAuthUI() {
    const loginBtn = document.getElementById('btn-guest-login');
    const chip = document.getElementById('guest-user-chip');
    const emailEl = document.getElementById('guest-user-email');
    const roleEl = document.getElementById('guest-user-role');

    if (currentUser) {
        loginBtn.classList.add('hidden');
        chip.classList.remove('hidden');
        chip.classList.add('flex');
        emailEl.innerText = currentUser.email || getUserDisplayName();
        roleEl.innerText = isAdminAuthed ? 'Staff' : 'Member';
    } else {
        loginBtn.classList.remove('hidden');
        chip.classList.add('hidden');
        chip.classList.remove('flex');
    }

    // 旅客前台的說明文字隨登入狀態調整
    if (currentView === 'guest') {
        document.getElementById('role-desc').innerText = currentUser
            ? `${getUserDisplayName()} 您好！可即時查看空房、挑選喜愛的房型並完成線上預約訂房。`
            : '您可以自由瀏覽與篩選空房；登入會員後即可線上預訂客房。';
    }

    updateCartUI();
}

// 將 Supabase 的英文錯誤訊息轉為中文提示
function translateAuthError(message = '') {
    const msg = message.toLowerCase();
    if (msg.includes('invalid login credentials')) return '信箱或密碼不正確';
    if (msg.includes('email not confirmed')) return '此信箱尚未完成驗證，請先至信箱收信';
    if (msg.includes('user already registered')) return '此信箱已註冊過，請直接登入';
    if (msg.includes('password should be at least')) return '密碼長度不足，請至少輸入 6 個字元';
    if (msg.includes('unable to validate email address')) return '信箱格式不正確';
    // 寄信額度與請求頻率是兩種不同的限制，訊息要分開講才找得到問題
    if (msg.includes('email rate limit') || msg.includes('email_send_rate_limit')) {
        return '系統寄送驗證信已達額度上限（內建郵件服務每小時 2 封）。請稍後再試，或請管理者關閉信箱驗證 / 改接自訂 SMTP。';
    }
    if (msg.includes('too many requests') || msg.includes('rate limit')) return '操作過於頻繁，請稍後再試';
    return message;
}

// ============================================================
// 員工登入 / 登出 (Supabase Auth)
// ============================================================

async function handleAdminLogin() {
    const email = document.getElementById('admin-login-email').value.trim();
    const password = document.getElementById('admin-login-password').value;
    const errorEl = document.getElementById('admin-login-error');
    const submitBtn = document.getElementById('admin-login-submit');

    errorEl.classList.add('hidden');

    if (!email || !password) {
        errorEl.innerText = '請輸入信箱與密碼';
        errorEl.classList.remove('hidden');
        return;
    }

    submitBtn.disabled = true;
    submitBtn.innerText = '登入中...';

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

    submitBtn.disabled = false;
    submitBtn.innerText = '登入';

    if (error) {
        errorEl.innerText = '登入失敗：' + translateAuthError(error.message);
        errorEl.classList.remove('hidden');
        return;
    }

    currentUser = data.user;
    isAdminAuthed = await checkIsStaff();
    refreshAuthUI();

    // 一般旅客會員即使登入成功，也沒有進入後台的權限
    if (!isAdminAuthed) {
        errorEl.innerText = '此帳號沒有員工權限，無法進入控房後台。';
        errorEl.classList.remove('hidden');
        await loadRooms();
        return;
    }

    document.getElementById('admin-login-email').value = '';
    document.getElementById('admin-login-password').value = '';
    closeModal('admin-login-modal');
    await finishSwitchToAdmin();
    showToast('✅ 員工登入成功');
}

async function adminLogout() {
    await supabaseClient.auth.signOut();
    currentUser = null;
    isAdminAuthed = false;
    myBookedRooms = [];
    refreshAuthUI();
    await switchView('guest');
    await loadRooms();
    showToast('已登出員工後台');
}

// ============================================================
// 前後台視圖切換
// ============================================================

// Toggle view between Guest (旅客) and Admin (員工)
async function switchView(view) {
    if (view === 'admin') {
        // 員工身分一律以資料庫端的 staff 名單為準（只有 session 還不夠）
        if (!isAdminAuthed) {
            const errorEl = document.getElementById('admin-login-error');
            errorEl.classList.add('hidden');

            const { data: { session } } = await supabaseClient.auth.getSession();
            isAdminAuthed = session ? await checkIsStaff() : false;

            if (!isAdminAuthed) {
                if (session) {
                    errorEl.innerText = '目前登入的帳號沒有員工權限，請改用員工帳號登入。';
                    errorEl.classList.remove('hidden');
                }
                openModal('admin-login-modal');
                return; // 尚未通過員工驗證前不切換畫面
            }
        }
        await finishSwitchToAdmin();
        return;
    }

    // 切回旅客前台
    currentView = 'guest';

    const btnGuest = document.getElementById('btn-guest-view');
    const btnAdmin = document.getElementById('btn-admin-view');
    const banner = document.getElementById('role-banner');
    const roleTitle = document.getElementById('role-title');
    const roleDesc = document.getElementById('role-desc');
    const adminSummary = document.getElementById('admin-summary');
    const adminActions = document.getElementById('admin-actions');
    const guestInfo = document.getElementById('guest-infobar');
    const logoutBtn = document.getElementById('btn-admin-logout');

    btnGuest.className = "px-4 py-1.5 rounded-xl text-sm font-bold transition-all duration-300 bg-white text-brand-600 shadow-sm flex items-center space-x-2";
    btnAdmin.className = "px-4 py-1.5 rounded-xl text-sm font-bold transition-all duration-300 text-slate-500 hover:text-slate-800 flex items-center space-x-2";

    banner.className = "bg-gradient-to-br from-brand-500 to-sky-400 p-5 rounded-3xl text-white shadow-xl shadow-brand-100 relative overflow-hidden";
    roleTitle.innerText = "旅客模式 🧳";
    roleDesc.innerText = currentUser
        ? `${getUserDisplayName()} 您好！可即時查看空房、挑選喜愛的房型並完成線上預約訂房。`
        : "您可以自由瀏覽與篩選空房；登入會員後即可線上預訂客房。";
    adminSummary.classList.add('hidden');
    adminActions.classList.add('hidden');
    guestInfo.classList.remove('hidden');
    logoutBtn.classList.add('hidden');

    showToast("已切換至 旅客前台 模式");

    renderRooms();
    updateSummaryCounters();
}

// 通過驗證後，實際切換到員工後台畫面
async function finishSwitchToAdmin() {
    currentView = 'admin';

    const btnGuest = document.getElementById('btn-guest-view');
    const btnAdmin = document.getElementById('btn-admin-view');
    const banner = document.getElementById('role-banner');
    const roleTitle = document.getElementById('role-title');
    const roleDesc = document.getElementById('role-desc');
    const adminSummary = document.getElementById('admin-summary');
    const adminActions = document.getElementById('admin-actions');
    const guestInfo = document.getElementById('guest-infobar');
    const logoutBtn = document.getElementById('btn-admin-logout');

    btnAdmin.className = "px-4 py-1.5 rounded-xl text-sm font-bold transition-all duration-300 bg-white text-slate-800 shadow-sm flex items-center space-x-2";
    btnGuest.className = "px-4 py-1.5 rounded-xl text-sm font-bold transition-all duration-300 text-slate-500 hover:text-slate-800 flex items-center space-x-2";

    banner.className = "bg-gradient-to-br from-slate-800 to-slate-900 p-5 rounded-3xl text-white shadow-xl shadow-slate-100 relative overflow-hidden";
    roleTitle.innerText = "員工後台 🛠️";
    roleDesc.innerText = "客房調配儀表板。您可以隨時切換房間狀態（空房、整理中、保留已訂）或修改定價。";
    adminSummary.classList.remove('hidden');
    adminActions.classList.remove('hidden');
    guestInfo.classList.add('hidden');
    logoutBtn.classList.remove('hidden');

    showToast("已進入 員工控房後台");

    await syncDefaultRoomsToSupabase();
    renderRooms();
    updateSummaryCounters();
}

// Toggle Type Filter Buttons UI state
function toggleTypeFilter(type) {
    currentTypeFilter = type;
    const buttons = {
        All: document.getElementById('btn-filter-all'),
        Single: document.getElementById('btn-filter-single'),
        Double: document.getElementById('btn-filter-double'),
        Family: document.getElementById('btn-filter-family')
    };

    Object.keys(buttons).forEach(key => {
        if (key === type) {
            buttons[key].className = "px-3 py-1.5 rounded-xl text-xs font-bold bg-brand-50 text-brand-600 border border-brand-100 transition-all";
        } else {
            buttons[key].className = "px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-50 hover:bg-slate-100 text-slate-600 transition-all";
        }
    });

    filterRooms();
}

// Core room rendering logic with Dynamic HTML Generation
function renderRooms() {
    const grid = document.getElementById('room-grid');
    const emptyState = document.getElementById('empty-state');
    const searchQuery = document.getElementById('search-room').value.toLowerCase().trim();

    // Filters values
    const checkin = document.getElementById('filter-checkin').value;
    const checkout = document.getElementById('filter-checkout').value;

    // Filter logic
    const filtered = rooms.filter(room => {
        // Type filter
        if (currentTypeFilter !== 'All' && room.type !== currentTypeFilter) return false;

        // Text search filter
        if (searchQuery) {
            const matchesSearch = room.id.includes(searchQuery) || room.name.toLowerCase().includes(searchQuery) || room.tags.some(tag => tag.toLowerCase().includes(searchQuery));
            if (!matchesSearch) return false;
        }

        return true;
    });

    // Empty state display
    if (filtered.length === 0) {
        grid.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
    } else {
        grid.classList.remove('hidden');
        emptyState.classList.add('hidden');
    }

    // HTML string building
    grid.innerHTML = filtered.map(room => {
        // Determine Status Badge & color theme
        let statusColor, statusLabel, actionButtonHTML;

        if (room.status === 'vacant') {
            statusColor = 'bg-emerald-500 text-white';
            statusLabel = '<i class="fa-solid fa-circle-check mr-1.5"></i> 空房中';

            if (currentView === 'guest') {
                actionButtonHTML = currentUser
                    ? `
                        <button onclick="openBookingModal('${room.id}')" class="w-full bg-brand-50 hover:bg-brand-100 text-brand-600 font-extrabold text-xs py-2.5 rounded-xl transition-all flex items-center justify-center gap-1.5">
                            <i class="fa-solid fa-calendar-plus"></i>
                            <span>立即預訂</span>
                        </button>
                    `
                    : `
                        <button onclick="openBookingModal('${room.id}')" class="w-full bg-slate-100 hover:bg-slate-200 text-slate-500 font-extrabold text-xs py-2.5 rounded-xl transition-all flex items-center justify-center gap-1.5">
                            <i class="fa-solid fa-lock"></i>
                            <span>登入後即可預訂</span>
                        </button>
                    `;
            } else {
                actionButtonHTML = `
                    <div class="grid grid-cols-2 gap-1.5">
                        <button onclick="changeRoomStatus('${room.id}', 'booked')" class="bg-orange-50 hover:bg-orange-100 text-orange-600 font-bold text-[10px] py-1.5 rounded-lg transition-all">設為已訂</button>
                        <button onclick="changeRoomStatus('${room.id}', 'maintenance')" class="bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-[10px] py-1.5 rounded-lg transition-all">設為維護</button>
                    </div>
                `;
            }
        } else if (room.status === 'booked') {
            const isMine = currentUser && room.bookedBy === currentUser.id;

            statusColor = isMine ? 'bg-brand-500 text-white' : 'bg-orange-500 text-white';
            statusLabel = isMine
                ? '<i class="fa-solid fa-circle-user mr-1.5"></i> 我的預訂'
                : `<i class="fa-solid fa-user-lock mr-1.5"></i> 已預訂 (${room.occupant || '旅客'})`;

            if (currentView === 'guest') {
                actionButtonHTML = isMine
                    ? `
                        <button onclick="cancelBookingByRoom('${room.id}')" class="w-full bg-rose-50 hover:bg-rose-100 text-rose-500 font-extrabold text-xs py-2.5 rounded-xl transition-all flex items-center justify-center gap-1.5">
                            <i class="fa-solid fa-calendar-xmark"></i>
                            <span>取消我的預訂</span>
                        </button>
                    `
                    : `
                        <button disabled class="w-full bg-slate-100 text-slate-400 font-bold text-xs py-2.5 rounded-xl cursor-not-allowed flex items-center justify-center gap-1.5">
                            <i class="fa-solid fa-lock"></i>
                            <span>已有人住</span>
                        </button>
                    `;
            } else {
                actionButtonHTML = `
                    <div class="grid grid-cols-2 gap-1.5">
                        <button onclick="changeRoomStatus('${room.id}', 'vacant')" class="bg-emerald-50 hover:bg-emerald-100 text-emerald-600 font-bold text-[10px] py-1.5 rounded-lg transition-all">釋出房源</button>
                        <button onclick="changeRoomStatus('${room.id}', 'maintenance')" class="bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-[10px] py-1.5 rounded-lg transition-all">設為維護</button>
                    </div>
                `;
            }
        } else {
            statusColor = 'bg-slate-500 text-white';
            statusLabel = '<i class="fa-solid fa-broom mr-1.5"></i> 清潔整理中';

            if (currentView === 'guest') {
                actionButtonHTML = `
                    <button disabled class="w-full bg-slate-100 text-slate-400 font-bold text-xs py-2.5 rounded-xl cursor-not-allowed flex items-center justify-center gap-1.5">
                        <i class="fa-solid fa-screwdriver-wrench"></i>
                        <span>清潔維護中</span>
                    </button>
                `;
            } else {
                actionButtonHTML = `
                    <div class="grid grid-cols-2 gap-1.5">
                        <button onclick="changeRoomStatus('${room.id}', 'vacant')" class="bg-emerald-50 hover:bg-emerald-100 text-emerald-600 font-bold text-[10px] py-1.5 rounded-lg transition-all">完成整理</button>
                        <button onclick="changeRoomStatus('${room.id}', 'booked')" class="bg-orange-50 hover:bg-orange-100 text-orange-600 font-bold text-[10px] py-1.5 rounded-lg transition-all">直接入住</button>
                    </div>
                `;
            }
        }

        // Room Type Icon Mapping
        let typeIcon = 'fa-bed';
        let typeLabel = '雙人房';
        if (room.type === 'Single') { typeIcon = 'fa-user-clock'; typeLabel = '單人套房'; }
        if (room.type === 'Family') { typeIcon = 'fa-people-roof'; typeLabel = '精緻家庭房'; }

        // Tag elements
        const tagsHTML = room.tags.map(tag => `<span class="bg-slate-50 border border-slate-100 px-2 py-0.5 rounded-md text-[10px] font-bold text-slate-400">${tag}</span>`).join('');

        // 每間房依房號取得專屬照片（同一房號固定同一張）
        const roomImage = getRoomImage(room.id, 'card');

        return `
            <div class="bg-white rounded-3xl border border-slate-100 overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 flex flex-col group">
                <!-- Card Image Header (點擊可放大) -->
                <div class="relative h-44 overflow-hidden shrink-0 cursor-zoom-in" onclick="openImageLightbox('${room.id}')" title="點擊放大檢視">
                    <img src="${roomImage}" alt="房號 ${room.id}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" onerror="this.onerror=null; this.src='https://placehold.co/500x320/e2e8f0/64748b?text=Room+Image'">
                    <!-- 底部漸層：確保左下角房號在亮色照片上也讀得清楚 -->
                    <div class="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-slate-900/65 to-transparent"></div>
                    <!-- 放大提示（滑過時淡入） -->
                    <div class="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-900/25 transition-all duration-300 flex items-center justify-center">
                        <div class="w-11 h-11 rounded-full bg-white/90 text-slate-700 flex items-center justify-center opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100 transition-all duration-300 shadow-lg">
                            <i class="fa-solid fa-magnifying-glass-plus"></i>
                        </div>
                    </div>
                    <!-- Status Overlay Badge -->
                    <div class="absolute top-4 right-4 px-3 py-1 rounded-full text-xs font-black shadow-md ${statusColor}">
                        ${statusLabel}
                    </div>
                    <!-- Room Number Badge -->
                    <div class="absolute bottom-4 left-4 bg-slate-900/75 backdrop-blur-sm text-white font-extrabold text-xs px-3 py-1 rounded-xl">
                        房號 ${room.id}
                    </div>
                </div>

                <!-- Card Body -->
                <div class="p-5 flex-grow flex flex-col justify-between">
                    <div class="space-y-2 mb-4">
                        <div class="flex items-center space-x-1.5 text-brand-600 font-bold text-[11px] uppercase tracking-wider">
                            <i class="fa-solid ${typeIcon}"></i>
                            <span>${typeLabel}</span>
                        </div>
                        <h3 class="font-bold text-slate-800 text-sm line-clamp-1">${room.name}</h3>
                        <!-- Facilities tags -->
                        <div class="flex flex-wrap gap-1">
                            ${tagsHTML}
                        </div>
                    </div>

                    <!-- Footer Section inside card -->
                    <div class="border-t border-slate-100/80 pt-3.5 flex flex-col gap-3">
                        <div class="flex justify-between items-baseline">
                            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">每晚房價</span>
                            <span class="font-black text-slate-800 text-lg">NT$ ${room.price.toLocaleString()}<span class="text-xs font-bold text-slate-400"> / 晚</span></span>
                        </div>

                        <div class="w-full">
                            ${actionButtonHTML}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Handle quick filter changes
function filterRooms() {
    renderRooms();
}

// Toggle Modal Displays helper
function toggleModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal.classList.contains('opacity-0')) {
        openModal(modalId);
    } else {
        closeModal(modalId);
    }
}

// 明確開啟 / 關閉（避免重複呼叫 toggle 造成狀態顛倒）
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.remove('opacity-0', 'pointer-events-none');
    modal.children[0].classList.remove('scale-95');
    modal.children[0].classList.add('scale-100');
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.add('opacity-0', 'pointer-events-none');
    modal.children[0].classList.remove('scale-100');
    modal.children[0].classList.add('scale-95');
}

// ============================================================
// 圖片燈箱：點擊房間照片放大檢視
// ============================================================
function openImageLightbox(roomId) {
    const room = rooms.find(r => r.id === roomId);
    if (!room) return;

    const box = document.getElementById('image-lightbox');
    const img = document.getElementById('lightbox-img');
    const spinner = document.getElementById('lightbox-loading');

    // 大圖需要重新下載，載入完成前先顯示轉圈
    spinner.classList.remove('hidden');
    img.classList.add('opacity-0');
    img.onload = () => {
        spinner.classList.add('hidden');
        img.classList.remove('opacity-0');
    };
    img.onerror = () => {
        spinner.classList.add('hidden');
        img.classList.remove('opacity-0');
        img.src = 'https://placehold.co/1200x800/e2e8f0/64748b?text=Room+Image';
    };

    img.src = getRoomImage(room.id, 'full');
    img.alt = `房號 ${room.id}`;

    document.getElementById('lightbox-room').innerText = `房號 ${room.id}`;
    document.getElementById('lightbox-name').innerText = room.name;
    document.getElementById('lightbox-price').innerText = `NT$ ${room.price.toLocaleString()} / 晚`;

    box.classList.remove('opacity-0', 'pointer-events-none');
    box.children[0].classList.remove('scale-95');
    document.body.classList.add('overflow-hidden');
}

function closeImageLightbox() {
    const box = document.getElementById('image-lightbox');
    box.classList.add('opacity-0', 'pointer-events-none');
    box.children[0].classList.add('scale-95');
    document.body.classList.remove('overflow-hidden');
}

// Trigger Guest Booking Modal with populated details
function openBookingModal(roomId) {
    const room = rooms.find(r => r.id === roomId);
    if (!room) return;

    // 未登入不得訂房：記住這間房，登入後自動接續預訂流程
    if (!currentUser) {
        pendingBookingRoom = room;
        showToast('🔒 請先登入會員才能預訂客房');
        openGuestAuthModal('login');
        return;
    }

    const checkin = document.getElementById('filter-checkin').value;
    const checkout = document.getElementById('filter-checkout').value;

    if (!checkin || !checkout) {
        showToast("⚠️ 請先選擇欲預訂的 入住 與 退房 日期！");
        return;
    }

    if (checkout <= checkin) {
        showToast("⚠️ 退房日期必須晚於入住日期！");
        return;
    }

    pendingBookingRoom = room;

    document.getElementById('book-modal-subtitle').innerText = `訂房人：${getUserDisplayName()}（${currentUser.email}）`;
    document.getElementById('book-modal-room').innerText = room.id;
    document.getElementById('book-modal-name').innerText = room.name;
    document.getElementById('book-modal-price').innerText = `NT$ ${room.price.toLocaleString()}`;
    document.getElementById('book-modal-dates').innerText = `${checkin} 至 ${checkout}`;

    openModal('booking-modal');
}

// Commit Guest Booking（透過 Supabase RPC，需攜帶登入後的 JWT）
async function confirmBooking() {
    if (!pendingBookingRoom) return;

    // 送出前再次確認權杖仍有效（可能已過期或在其他分頁登出）
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        closeModal('booking-modal');
        pendingBookingRoom = null;
        currentUser = null;
        refreshAuthUI();
        showToast('🔒 登入已逾期，請重新登入後再訂房');
        openGuestAuthModal('login');
        return;
    }

    const checkin = document.getElementById('filter-checkin').value;
    const checkout = document.getElementById('filter-checkout').value;
    const targetRoom = pendingBookingRoom;

    const { error } = await supabaseClient.rpc('book_room', {
        p_room_id: targetRoom.id,
        p_checkin: checkin,
        p_checkout: checkout,
        p_guest_name: getUserDisplayName()
    });

    if (error) {
        showToast('⚠️ 預訂失敗：' + error.message);
        closeModal('booking-modal');
        pendingBookingRoom = null;
        return;
    }

    closeModal('booking-modal');
    await loadRooms();   // 訂房清單會依 booked_by = 我的 uid 重新載入

    showToast(`🎉 成功預訂 房號 ${targetRoom.id}！`);
    pendingBookingRoom = null;
}

// Admin: Direct change room status（需已通過員工登入驗證，寫入受 RLS 保護）
async function changeRoomStatus(roomId, newStatus) {
    const patch = { status: newStatus };
    if (newStatus === 'vacant') {
        patch.occupant = '';
        patch.checkin_date = null;
        patch.checkout_date = null;
    } else if (newStatus === 'booked') {
        patch.occupant = '現場安排旅客';
        patch.checkin_date = '2026-07-14';
        patch.checkout_date = '2026-07-15';
    }

    const { error } = await supabaseClient.from('rooms').update(patch).eq('id', roomId);

    if (error) {
        showToast('⚠️ 更新房況失敗：' + error.message + '（請確認是否已登入員工帳號）');
        return;
    }

    await loadRooms();
    showToast(`房號 ${roomId} 已變更為「${newStatus === 'vacant' ? '空房' : newStatus === 'booked' ? '已訂' : '維護'}」`);
}

// Admin: Add new Room dynamically（寫入 Supabase，需已登入員工帳號）
async function addNewRoom() {
    const id = document.getElementById('new-room-id').value.trim();
    const name = document.getElementById('new-room-name').value.trim() || `精緻套房 ${id}`;
    const type = document.getElementById('new-room-type').value;
    const priceVal = document.getElementById('new-room-price').value.trim();
    const tagsInput = document.getElementById('new-room-tags').value.trim();

    if (!id) {
        showToast("⚠️ 請輸入房號！");
        return;
    }

    if (rooms.some(r => r.id === id)) {
        showToast("⚠️ 此房號已存在！");
        return;
    }

    const price = priceVal ? parseInt(priceVal) : (type === 'Single' ? 1500 : type === 'Double' ? 2500 : 4000);
    const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()) : ['全新裝修', '備品齊全'];

    const { error } = await supabaseClient.from('rooms').insert({
        id, name, type, price,
        status: 'vacant',
        tags,
        occupant: '',
        checkin_date: null,
        checkout_date: null
    });

    if (error) {
        showToast('⚠️ 新增房間失敗：' + error.message + '（請確認是否已登入員工帳號）');
        return;
    }

    // Clear inputs
    document.getElementById('new-room-id').value = '';
    document.getElementById('new-room-name').value = '';
    document.getElementById('new-room-price').value = '';
    document.getElementById('new-room-tags').value = '';

    toggleModal('add-room-modal');
    await loadRooms();
    showToast(`✨ 成功新增客房 ${id} - ${name}！`);
}

// Sync and Calculate counters
function updateSummaryCounters() {
    const vacantCount = rooms.filter(r => r.status === 'vacant').length;
    const bookedCount = rooms.filter(r => r.status === 'booked').length;
    const cleanCount = rooms.filter(r => r.status === 'maintenance').length;

    document.getElementById('sum-vacant').innerText = vacantCount;
    document.getElementById('sum-booked').innerText = bookedCount;
    document.getElementById('sum-clean').innerText = cleanCount;
}

// Sync Sim Cart UI
function updateCartUI() {
    const cartList = document.getElementById('booking-cart-list');
    const cartTotal = document.getElementById('booking-cart-total');
    const totalVal = document.getElementById('cart-total-price');
    const badge = document.getElementById('booking-badge');

    badge.innerText = `${myBookedRooms.length} 間`;

    // 未登入時不顯示任何訂房紀錄，改為引導登入
    if (!currentUser) {
        badge.innerText = '未登入';
        cartList.innerHTML = `
            <div class="text-center py-4 flex flex-col items-center gap-2">
                <i class="fa-solid fa-lock text-slate-500 text-lg"></i>
                <p class="text-slate-400 italic">登入會員後即可訂房與查看紀錄</p>
                <button onclick="openGuestAuthModal('login')" class="bg-brand-500 hover:bg-brand-600 text-white text-[10px] font-bold px-3 py-1.5 rounded-xl transition-all">
                    立即登入 / 註冊
                </button>
            </div>
        `;
        cartTotal.classList.add('hidden');
        return;
    }

    if (myBookedRooms.length === 0) {
        cartList.innerHTML = `<p class="text-slate-400 italic text-center py-4">目前尚未預訂任何客房</p>`;
        cartTotal.classList.add('hidden');
        return;
    }

    cartTotal.classList.remove('hidden');

    let totalSum = 0;
    let cartHTML = myBookedRooms.map((bk, idx) => {
        totalSum += bk.price;
        return `
            <div class="bg-slate-800 p-2.5 rounded-xl border border-slate-700/50 flex justify-between items-center group">
                <div class="truncate">
                    <div class="font-extrabold flex items-center gap-1">
                        <span class="bg-brand-500 text-[10px] text-white px-1.5 py-0.2 rounded-md font-black">${bk.id}</span>
                        <span class="truncate text-slate-100">${bk.name}</span>
                    </div>
                    <div class="text-[9px] text-slate-400 mt-0.5">${bk.checkin} - ${bk.checkout}</div>
                </div>
                <div class="text-right shrink-0">
                    <div class="font-bold text-brand-400">NT$ ${bk.price.toLocaleString()}</div>
                    <button onclick="cancelMyBooking(${idx})" class="text-[9px] text-rose-400 hover:text-rose-300 font-extrabold underline block ml-auto mt-0.5">退訂</button>
                </div>
            </div>
        `;
    }).join('');

    cartList.innerHTML = cartHTML;
    totalVal.innerText = `NT$ ${totalSum.toLocaleString()}`;
}

// Cancel booking from myCart list（透過 Supabase RPC 釋出房源，需帶 JWT）
async function cancelMyBooking(idx) {
    const removed = myBookedRooms[idx];
    if (!removed) return;
    await cancelBookingByRoom(removed.id);
}

// 以房號取消預訂（資料庫端會驗證這筆訂房是否屬於目前登入者）
async function cancelBookingByRoom(roomId) {
    if (!currentUser) {
        showToast('🔒 請先登入會員');
        openGuestAuthModal('login');
        return;
    }

    const { error } = await supabaseClient.rpc('cancel_booking', { p_room_id: roomId });

    if (error) {
        showToast('⚠️ 取消預訂失敗：' + error.message);
        return;
    }

    await loadRooms();
    showToast(`已為您退訂 ${roomId} 房`);
}

// 登入視窗支援 Enter 送出 / Esc 關閉
document.addEventListener('keydown', (e) => {
    const guestModal = document.getElementById('guest-auth-modal');
    const adminModal = document.getElementById('admin-login-modal');
    const isOpen = (m) => m && !m.classList.contains('opacity-0');

    if (e.key === 'Enter') {
        if (isOpen(guestModal) && guestModal.contains(document.activeElement)) {
            e.preventDefault();
            submitGuestAuth();
        } else if (isOpen(adminModal) && adminModal.contains(document.activeElement)) {
            e.preventDefault();
            handleAdminLogin();
        }
    } else if (e.key === 'Escape') {
        const lightbox = document.getElementById('image-lightbox');
        if (isOpen(lightbox)) {
            closeImageLightbox();
            return;   // 燈箱疊在最上層，優先關它
        }
        if (isOpen(guestModal)) closeModal('guest-auth-modal');
        if (isOpen(adminModal)) closeModal('admin-login-modal');
    }
});

// Helper Notification Toast message
function showToast(msg) {
    const toast = document.getElementById('toast-notif');
    const text = document.getElementById('toast-text');

    text.innerText = msg;

    toast.classList.remove('translate-y-24', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');

    setTimeout(() => {
        toast.classList.remove('translate-y-0', 'opacity-100');
        toast.classList.add('translate-y-24', 'opacity-0');
    }, 3000);
}