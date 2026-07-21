// 模擬房間資料庫 (預留後續可透過 API 替換)
let rooms = [
    { id: '101', number: '101', type: 'single', typeName: '溫馨單人房', price: 1800, status: 'available', image: 'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?auto=format&fit=crop&w=600&q=80' },
    { id: '102', number: '102', type: 'double', typeName: '經典雙人房', price: 2600, status: 'booked', image: 'https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=600&q=80' },
    { id: '103', number: '103', type: 'suite', typeName: '海景豪華套房', price: 4200, status: 'available', image: 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=600&q=80' },
    { id: '104', number: '104', type: 'family', typeName: '溫馨家庭四人房', price: 5000, status: 'maintenance', image: 'https://images.unsplash.com/photo-1566665797739-1674de7a421a?auto=format&fit=crop&w=600&q=80' },
    { id: '201', number: '201', type: 'double', typeName: '陽台雙人房', price: 2900, status: 'available', image: 'https://images.unsplash.com/photo-1591088398332-8a7791972843?auto=format&fit=crop&w=600&q=80' }
];

let isAdminMode = false;

// DOM 元素選取
const guestBtn = document.getElementById('guest-mode-btn');
const adminBtn = document.getElementById('admin-mode-btn');
const guestSearchSection = document.getElementById('guest-search-section');
const adminControlSection = document.getElementById('admin-control-section');
const roomGrid = document.getElementById('room-grid');
const typeFilter = document.getElementById('type-filter');
const searchBtn = document.getElementById('search-btn');

// Modal 元素選取
const bookingModal = document.getElementById('booking-modal');
const addRoomModal = document.getElementById('add-room-modal');
const closeBookingModal = document.getElementById('close-booking-modal');
const closeAddModal = document.getElementById('close-add-modal');
const addRoomBtn = document.getElementById('add-room-btn');
const bookingForm = document.getElementById('booking-form');
const addRoomForm = document.getElementById('add-room-form');

// 前/後台模式切換事件
guestBtn.addEventListener('click', () => setMode(false));
adminBtn.addEventListener('click', () => setMode(true));

function setMode(admin) {
    isAdminMode = admin;
    if (admin) {
        guestBtn.classList.remove('active');
        adminBtn.classList.add('active');
        guestSearchSection.classList.add('hidden');
        adminControlSection.classList.remove('hidden');
    } else {
        adminBtn.classList.remove('active');
        guestBtn.classList.add('active');
        adminControlSection.classList.add('hidden');
        guestSearchSection.classList.remove('hidden');
    }
    renderRooms();
}

// 動態渲染客房卡片
function renderRooms(filteredType = 'all') {
    roomGrid.innerHTML = '';
    
    const displayRooms = filteredType === 'all' 
        ? rooms 
        : rooms.filter(r => r.type === filteredType);

    if (displayRooms.length === 0) {
        roomGrid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--text-secondary); padding: 40px 0;">尚無符合條件的房間</p>';
        return;
    }

    displayRooms.forEach(room => {
        const card = document.createElement('div');
        card.className = 'room-card';

        const statusText = {
            available: '可預訂',
            booked: '已預訂',
            maintenance: '維護中'
        }[room.status];

        card.innerHTML = `
            <div class="room-img-wrapper">
                <img src="${room.image}" alt="房號 ${room.number}">
                <span class="status-badge ${room.status}">${statusText}</span>
            </div>
            <div class="room-info">
                <div class="room-title">
                    <span class="room-number">房號 ${room.number}</span>
                    <span class="room-price">NT$ ${room.price.toLocaleString()} / 晚</span>
                </div>
                <div class="room-type">${room.typeName}</div>
                <div class="room-actions">
                    ${renderActionButtons(room)}
                </div>
            </div>
        `;
        roomGrid.appendChild(card);
    });
}

// 依據模式與狀態生成對應操作按鈕
function renderActionButtons(room) {
    if (!isAdminMode) {
        // 旅客前台模式
        if (room.status === 'available') {
            return `<button class="btn btn-primary btn-full" onclick="openBookingModal('${room.id}')">立即預訂</button>`;
        } else {
            return `<button class="btn btn-full" style="background:#CBD5E0; color:white; cursor:not-allowed;" disabled>不可預訂</button>`;
        }
    } else {
        // 管理後台模式：提供狀態快速切換選單
        return `
            <div class="admin-actions">
                <select onchange="updateRoomStatus('${room.id}', this.value)">
                    <option value="available" ${room.status === 'available' ? 'selected' : ''}>設為可預訂</option>
                    <option value="booked" ${room.status === 'booked' ? 'selected' : ''}>設為已預訂</option>
                    <option value="maintenance" ${room.status === 'maintenance' ? 'selected' : ''}>設為維護中</option>
                </select>
            </div>
        `;
    }
}

// 後台更新房間狀態
window.updateRoomStatus = function(roomId, newStatus) {
    const room = rooms.find(r => r.id === roomId);
    if (room) {
        room.status = newStatus;
        renderRooms(typeFilter.value);
    }
};

// 前台篩選按鈕觸發
searchBtn.addEventListener('click', () => {
    renderRooms(typeFilter.value);
});

// Modal 觸發與關閉邏輯
window.openBookingModal = function(roomId) {
    const room = rooms.find(r => r.id === roomId);
    if (room) {
        document.getElementById('modal-room-id').value = room.id;
        document.getElementById('modal-room-title').innerText = `預訂 房號 ${room.number} (${room.typeName})`;
        bookingModal.classList.remove('hidden');
    }
};

closeBookingModal.addEventListener('click', () => bookingModal.classList.add('hidden'));
closeAddModal.addEventListener('click', () => addRoomModal.classList.add('hidden'));
addRoomBtn.addEventListener('click', () => addRoomModal.classList.remove('hidden'));

// 預訂表單送出事件
bookingForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const roomId = document.getElementById('modal-room-id').value;
    const name = document.getElementById('guest-name').value;
    
    const room = rooms.find(r => r.id === roomId);
    if (room) {
        room.status = 'booked';
        alert(`🎉 預訂成功！感謝 ${name}，我們已為您保留 房號 ${room.number}。`);
        bookingModal.classList.add('hidden');
        bookingForm.reset();
        renderRooms(typeFilter.value);
    }
});

// 新增客房表單送出事件
addRoomForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const number = document.getElementById('new-room-number').value;
    const type = document.getElementById('new-room-type').value;
    const price = parseInt(document.getElementById('new-room-price').value);
    const image = document.getElementById('new-room-image').value;

    const typeNames = {
        single: '單人房',
        double: '雙人房',
        suite: '景觀套房',
        family: '家庭四人房'
    };

    const newRoom = {
        id: Date.now().toString(),
        number: number,
        type: type,
        typeName: typeNames[type] || '標準客房',
        price: price,
        status: 'available',
        image: image
    };

    rooms.push(newRoom);
    alert(`✨ 成功新增房號 ${number}！`);
    addRoomModal.classList.add('hidden');
    addRoomForm.reset();
    renderRooms(typeFilter.value);
});

// 初始化頁面渲染
renderRooms();