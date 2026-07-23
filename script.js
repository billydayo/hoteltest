// ============================================================
// Supabase 連線設定
// 請將以下兩個值換成你自己 Supabase 專案的 Project URL 與 anon public key
// (Supabase Dashboard → Project Settings → API)
// ============================================================
const SUPABASE_URL = 'https://ifggswbwqeanhlhhcbli.supabase.co/rest/v1/';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlmZ2dzd2J3cWVhbmhsaGhjYmxpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3NTU1MDQsImV4cCI6MjEwMDMzMTUwNH0.JYPzcC5t3is4PRdXU42E3iEeoXGiKKV8pRR3zCS4t_g';

// persistSession 設為 false：不使用 localStorage 存放登入狀態，
// 改為僅存在當前分頁的記憶體中（重新整理頁面需要重新登入）。
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false }
});

// App state variables
let rooms = [];               // 從 Supabase 讀取的房間資料
let currentView = 'guest';    // 'guest' or 'admin'
let currentTypeFilter = 'All';
let pendingBookingRoom = null;
let myBookedRooms = [];       // 本次瀏覽中，我(旅客)模擬預訂的房間清單（僅存於記憶體）
let isAdminAuthed = false;    // 目前是否已通過員工登入驗證
let realtimeChannel = null;

// Setup Dates default inputs to current date + initial data load
window.onload = async function() {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    document.getElementById('filter-checkin').value = today.toISOString().split('T')[0];
    document.getElementById('filter-checkout').value = tomorrow.toISOString().split('T')[0];

    await loadRooms();
    subscribeRealtime();
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

    rooms = (data || []).map(r => ({
        id: r.id,
        name: r.name,
        type: r.type,
        price: r.price,
        status: r.status,
        tags: r.tags || [],
        occupant: r.occupant || '',
        checkinDate: r.checkin_date || '',
        checkoutDate: r.checkout_date || ''
    }));

    renderRooms();
    updateSummaryCounters();
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
        errorEl.innerText = '登入失敗：' + error.message;
        errorEl.classList.remove('hidden');
        return;
    }

    isAdminAuthed = true;
    document.getElementById('admin-login-email').value = '';
    document.getElementById('admin-login-password').value = '';
    toggleModal('admin-login-modal');
    finishSwitchToAdmin();
    showToast('✅ 員工登入成功');
}

async function adminLogout() {
    await supabaseClient.auth.signOut();
    isAdminAuthed = false;
    switchView('guest');
    showToast('已登出員工後台');
}

// ============================================================
// 前後台視圖切換
// ============================================================

// Toggle view between Guest (旅客) and Admin (員工)
async function switchView(view) {
    if (view === 'admin') {
        // 若尚未通過員工登入驗證，先檢查現有 session，否則彈出登入視窗
        if (!isAdminAuthed) {
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (session) {
                isAdminAuthed = true;
            } else {
                toggleModal('admin-login-modal');
                return; // 尚未登入前不切換畫面
            }
        }
        finishSwitchToAdmin();
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
    roleDesc.innerText = "您可以即時查看空房、挑選喜愛的房型、並在線上模擬完成預約訂房！";
    adminSummary.classList.add('hidden');
    adminActions.classList.add('hidden');
    guestInfo.classList.remove('hidden');
    logoutBtn.classList.add('hidden');

    showToast("已切換至 旅客前台 模式");

    renderRooms();
    updateSummaryCounters();
}

// 通過驗證後，實際切換到員工後台畫面
function finishSwitchToAdmin() {
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
                actionButtonHTML = `
                    <button onclick="openBookingModal('${room.id}')" class="w-full bg-brand-50 hover:bg-brand-100 text-brand-600 font-extrabold text-xs py-2.5 rounded-xl transition-all flex items-center justify-center gap-1.5">
                        <i class="fa-solid fa-calendar-plus"></i>
                        <span>立即預訂</span>
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
            statusColor = 'bg-orange-500 text-white';
            statusLabel = `<i class="fa-solid fa-user-lock mr-1.5"></i> 已預訂 (${room.occupant || '旅客'})`;

            if (currentView === 'guest') {
                actionButtonHTML = `
                    <button disabled class="w-full bg-slate-100 text-slate-400 font-bold text-xs py-2.5 rounded-xl cursor-not-allowed flex items-center justify-center gap-1.5">
                        <i class="fa-solid fa-lock"></i>
                        <span>已被客滿</span>
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

        // Custom Unsplash-like placeholder images depending on room type to ensure aesthetic excellence
        let roomImage = `https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=400&q=80`; // Default Double
        if (room.type === 'Single') roomImage = `https://images.unsplash.com/photo-1598928506311-c55ded91a20c?auto=format&fit=crop&w=400&q=80`;
        if (room.type === 'Family') roomImage = `https://images.unsplash.com/photo-1566665797739-1674de7a421a?auto=format&fit=crop&w=400&q=80`;

        return `
            <div class="bg-white rounded-3xl border border-slate-100 overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 flex flex-col group">
                <!-- Card Image Header -->
                <div class="relative h-44 overflow-hidden shrink-0">
                    <img src="${roomImage}" alt="${room.name}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" onerror="this.onerror=null; this.src='https://placehold.co/400x200/e2e8f0/64748b?text=Room+Image'">
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
        modal.classList.remove('opacity-0', 'pointer-events-none');
        modal.children[0].classList.remove('scale-95');
        modal.children[0].classList.add('scale-100');
    } else {
        modal.classList.add('opacity-0', 'pointer-events-none');
        modal.children[0].classList.remove('scale-100');
        modal.children[0].classList.add('scale-95');
    }
}

// Trigger Guest Booking Modal with populated details
function openBookingModal(roomId) {
    const checkin = document.getElementById('filter-checkin').value;
    const checkout = document.getElementById('filter-checkout').value;

    if (!checkin || !checkout) {
        showToast("⚠️ 請先選擇欲預訂的 入住 與 退房 日期！");
        return;
    }

    const room = rooms.find(r => r.id === roomId);
    if (!room) return;

    pendingBookingRoom = room;

    document.getElementById('book-modal-room').innerText = room.id;
    document.getElementById('book-modal-name').innerText = room.name;
    document.getElementById('book-modal-price').innerText = `NT$ ${room.price.toLocaleString()}`;
    document.getElementById('book-modal-dates').innerText = `${checkin} 至 ${checkout}`;

    toggleModal('booking-modal');
}

// Commit Guest Simulated Booking（透過 Supabase RPC，無需登入即可預訂）
async function confirmBooking() {
    if (!pendingBookingRoom) return;

    const checkin = document.getElementById('filter-checkin').value;
    const checkout = document.getElementById('filter-checkout').value;
    const targetRoom = pendingBookingRoom;

    const { error } = await supabaseClient.rpc('book_room', {
        p_room_id: targetRoom.id,
        p_checkin: checkin,
        p_checkout: checkout,
        p_guest_name: '模擬旅客 (您)'
    });

    if (error) {
        showToast('⚠️ 預訂失敗：' + error.message);
        toggleModal('booking-modal');
        pendingBookingRoom = null;
        return;
    }

    // Add to simulated cart/booking log（僅存於本次瀏覽的記憶體中）
    myBookedRooms.push({
        id: targetRoom.id,
        name: targetRoom.name,
        price: targetRoom.price,
        checkin,
        checkout
    });

    toggleModal('booking-modal');
    await loadRooms();
    updateCartUI();

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

// Cancel simulated booking from myCart list（透過 Supabase RPC 釋出房源）
async function cancelMyBooking(idx) {
    const removed = myBookedRooms[idx];

    const { error } = await supabaseClient.rpc('cancel_booking', { p_room_id: removed.id });

    if (error) {
        showToast('⚠️ 取消預訂失敗：' + error.message);
        return;
    }

    myBookedRooms.splice(idx, 1);

    await loadRooms();
    updateCartUI();
    showToast(`已為您退訂 ${removed.id} 房`);
}

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