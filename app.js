// =============================================
//  W1 Goiânia – Reservas  (app.js)
//  Auth · Navegação · Reservas · CRUD Usuários
// =============================================

const SUPABASE_URL = 'https://dicavscewjdvxceqbtbk.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpY2F2c2Nld2pkdnhjZXFidGJrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyOTc2NTMsImV4cCI6MjA5MTg3MzY1M30.qD-jTm9cCB2axOXqbMzicBZ8zQzy8n5uGGtYwguDwks';

const ADMIN_EMAIL = 'paulograciano.w1@gmail.com';

// Inicialização básica (mais estável para CDN)
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        storage: window.localStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
    }
});

// Teste de conexão imediato
_supabase.from('profiles').select('count', { count: 'exact', head: true })
    .then(({ error }) => {
        if (error) console.error("⚠️ Teste de conexão falhou:", error.message || error);
        else console.log("✅ Conexão com Supabase estabelecida com sucesso.");
    })
    .catch(err => console.error("❌ Erro crítico na inicialização:", err));

// Debug: Verificar se existe sessão no localStorage ao carregar
console.log("🔍 Verificando localStorage para sessão Supabase:", Object.keys(localStorage).filter(k => k.includes('supabase.auth.token')));

// ──── State ────
let currentUser = null;
let currentProfile = null;
let currentRole = null;
let calendar = null;
let allUsers = [];
let editingUserId = null;

// =============================================
//  TOAST NOTIFICATIONS
// =============================================
function toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span>${message}</span>`;
    container.appendChild(el);
    setTimeout(() => el.remove(), 3200);
}

// =============================================
//  AUTH – LOGIN / LOGOUT
// =============================================

async function loginWithGoogle() {
    // Redirecionamento dinâmico para garantir compatibilidade com GitHub Pages
    const redirectUrl = window.location.origin + window.location.pathname;

    console.log("Iniciando Login Google. Redirecionando para:", redirectUrl);

    const { error } = await _supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: redirectUrl
        }
    });

    if (error) {
        console.error("Erro Google Login:", error);
        const errorEl = document.getElementById('login-error');
        errorEl.textContent = 'Erro ao conectar com Google: ' + error.message;
        errorEl.classList.add('visible');
    }
}

async function logout() {
    try {
        console.log("📤 Iniciando Logout...");
        const { error } = await _supabase.auth.signOut();
        if (error) throw error;
        
        currentUser = null;
        currentProfile = null;
        currentRole = null;
        if (calendar) { 
            console.log("🗑 Destruindo instância do calendário");
            calendar.destroy(); 
            calendar = null; 
        }
        console.log("✅ Logout concluído com sucesso.");
    } catch (err) {
        console.error("❌ Erro ao sair:", err);
        toast("Erro ao sair. Tente recarregar a página.", "error");
    }
}



// =============================================
//  AUTH STATE CHANGE
// =============================================
_supabase.auth.onAuthStateChange(async (event, session) => {
    console.log(`🔑 Evento Auth: ${event}`, session ? "Sessão Ativa" : "Sem Sessão");

    if (session) {
        currentUser = session.user;

        // Tentar buscar o perfil com até 3 tentativas em caso de erro de rede
        let profile = null;
        let fetchError = null;
        
        try {
            const { data, error } = await _supabase
                .from('profiles')
                .select('*')
                .eq('id', currentUser.id)
                .single();
            profile = data;
            fetchError = error;
        } catch (e) {
            console.error("Erro na busca de perfil:", e);
        }

        // Se logou com Google (ou conta nova) e não achou profile (se trigger falhou ou apagaram)
        if (!profile && !fetchError) {
            console.log("ℹ️ Perfil não encontrado. Verificando se é admin...");
            const userEmail = currentUser.email;
            const isAdmin = userEmail === ADMIN_EMAIL;

            if (isAdmin) {
                const userName = currentUser.user_metadata?.full_name
                    || currentUser.user_metadata?.name
                    || userEmail.split('@')[0];

                const newProfile = {
                    id: currentUser.id,
                    full_name: userName,
                    email: userEmail,
                    role: 'admin',
                    status: 'active'
                };

                const { data: inserted, error: insertErr } = await _supabase
                    .from('profiles')
                    .upsert(newProfile)
                    .select()
                    .single();

                if (insertErr) {
                    console.error('Erro ao recriar perfil admin:', insertErr);
                    profile = newProfile;
                } else {
                    profile = inserted;
                }
                toast(`Bem-vindo, Admin! Seu perfil foi restaurado.`, 'success');
            } else {
                console.warn("🚫 Usuário sem perfil. Forçando logout.");
                toast('Seu acesso não foi liberado. Contate o administrador.', 'error');
                await _supabase.auth.signOut();
                return;
            }
        }

        if (profile) {
            // Check if admin email needs role upgrade
            if (currentUser.email === ADMIN_EMAIL && profile.role !== 'admin') {
                await _supabase.from('profiles').update({ role: 'admin' }).eq('id', currentUser.id);
                profile.role = 'admin';
            }

            if (profile.status === 'inactive') {
                toast('Conta desativada. Contate o administrador.', 'error');
                await _supabase.auth.signOut();
                return;
            }

            currentProfile = profile;
            currentRole = profile.role || 'bp';
            
            console.log("👤 Usuário logado como:", currentRole);
        }

        // Update sidebar user info
        const initials = getInitials(profile.full_name || currentUser.email);
        document.getElementById('sidebar-avatar').textContent = initials;
        document.getElementById('sidebar-user-name').textContent = profile.full_name || currentUser.email;
        document.getElementById('sidebar-user-role').textContent = currentRole.toUpperCase();

        // Show/hide admin nav
        const navUsuarios = document.getElementById('nav-usuarios');
        if (currentRole === 'admin') {
            navUsuarios.style.display = 'flex';
        } else {
            navUsuarios.style.display = 'none';
        }

        // Switch screens
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app-screen').style.display = 'flex';

        // Init calendar
        setupRoomSelect();
        if (!calendar) initCalendar();
        else calendar.refetchEvents();

    } else {
        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('app-screen').style.display = 'none';
        currentUser = null;
        currentProfile = null;
        currentRole = null;
        if (calendar) { calendar.destroy(); calendar = null; }
    }
});

function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// =============================================
//  NAVIGATION
// =============================================
function navigateTo(page) {
    try {
        console.log(`🚀 Navegando para: ${page}`);
        
        // Update nav
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        const activeNav = document.querySelector(`.nav-item[data-page="${page}"]`);
        if (activeNav) activeNav.classList.add('active');

        // Show/hide pages
        document.querySelectorAll('.page-content').forEach(p => p.classList.add('hidden'));
        const target = document.getElementById(`page-${page}`);
        if (target) {
            target.classList.remove('hidden');
        } else {
            console.warn(`⚠️ Página não encontrada: page-${page}`);
        }

        // Load data
        if (page === 'usuarios' && currentRole === 'admin') {
            loadUsers();
        }

        // Close mobile sidebar
        closeSidebar();
    } catch (err) {
        console.error("❌ Erro crítico na navegação:", err);
    }
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('mobile-overlay').classList.toggle('visible');
}

function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('mobile-overlay').classList.remove('visible');
}

// =============================================
//  CALENDAR
// =============================================
function initCalendar() {
    const calendarEl = document.getElementById('calendar');
    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'timeGridWeek',
        locale: 'pt-br',
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'timeGridWeek,timeGridDay'
        },
        slotMinTime: "07:00:00",
        slotMaxTime: "22:00:00",
        allDaySlot: false,
        height: 'auto',
        timeZone: 'local', // Garante que as datas sejam interpretadas no horário local
        events: fetchEvents,
        eventClick: handleEventClick
    });
    calendar.render();
}

async function fetchEvents(info, successCallback, failureCallback) {
    const { data, error } = await _supabase
        .from('reservations')
        .select(`
            id, room_number, start_time, end_time, user_id,
            profiles ( full_name )
        `);

    if (error) {
        console.error("Erro ao buscar reservas:", error.message || error);
        failureCallback(error);
        return;
    }

    const events = data.map(res => ({
        id: res.id,
        title: `Sala ${res.room_number} — ${res.profiles?.full_name || 'Reservado'}`,
        start: res.start_time,
        end: res.end_time,
        backgroundColor: getRoomColor(res.room_number),
        extendedProps: { user_id: res.user_id, room_number: res.room_number }
    }));
    
    successCallback(events);
}

function getRoomColor(room) {
    const colors = [
        '#0d9488', '#d4a853', '#6366f1',
        '#ec4899', '#f97316', '#8b5cf6'
    ];
    return colors[(room - 1) % colors.length];
}

async function handleEventClick(info) {
    const event = info.event;
    const userId = event.extendedProps.user_id;

    // Only allow owner or admin to delete
    if (currentUser.id !== userId && currentRole !== 'admin') {
        toast('Você só pode cancelar suas próprias reservas.', 'info');
        return;
    }

    openConfirmModal(
        'Cancelar Reserva',
        `Deseja cancelar a reserva <span class="confirm-highlight">${event.title}</span>?`,
        async () => {
            console.log("Iniciando exclusão da reserva ID:", event.id);
            try {
                const { error } = await _supabase.from('reservations').delete().eq('id', event.id);
                if (error) {
                    console.error("Erro Supabase Delete:", error);
                    toast('Erro ao cancelar: ' + error.message, 'error');
                } else {
                    console.log("Reserva excluída com sucesso.");
                    toast('Reserva cancelada.', 'success');
                    if (calendar) calendar.refetchEvents();
                }
            } catch (err) {
                console.error("Erro inesperado ao deletar:", err);
                toast('Erro técnico ao cancelar. Verifique o console.', 'error');
            }
        }
    );
}

function refreshCalendar() {
    if (calendar) {
        const btn = document.getElementById('btn-refresh-calendar');
        btn.classList.add('rotating');
        calendar.refetchEvents();
        setTimeout(() => btn.classList.remove('rotating'), 800);
        toast('Agenda atualizada', 'success');
    }
}

// =============================================
//  BOOKING MODAL
// =============================================
function setupRoomSelect() {
    const select = document.getElementById('room-select');
    select.innerHTML = '';
    const maxRooms = (currentRole === 'bp') ? 3 : 6;
    for (let i = 1; i <= maxRooms; i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.innerText = `Sala ${i}`;
        select.appendChild(opt);
    }
}

function openBookingModal() {
    document.getElementById('booking-modal').classList.add('visible');
}

function closeBookingModal() {
    document.getElementById('booking-modal').classList.remove('visible');
    document.getElementById('start-time').value = '';
    document.getElementById('end-time').value = '';
}

async function saveReservation() {
    const btn = document.querySelector('#booking-modal .btn-primary');
    
    try {
        const room = document.getElementById('room-select').value;
        const start = document.getElementById('start-time').value;
        const end = document.getElementById('end-time').value;

        if (!room || !start || !end) return toast("Preencha todos os campos.", "error");

        const startDate = new Date(start);
        const endDate = new Date(end);

        if (startDate >= endDate) return toast("O horário de fim deve ser após o início.", "error");
        
        const now = new Date();
        if (startDate < now) return toast("Não é possível reservar no passado.", "error");

        if (!currentUser) {
            toast("Sessão expirada. Por favor, recarregue a página.", "error");
            return;
        }

        btn.disabled = true;
        btn.innerHTML = '<span class="loading-spinner"></span> Confirmando...';

        console.log("💾 Salvando reserva...", { room, start, end, user_id: currentUser.id });

        // Converte os horários locais do formulário para o formato ISO preservando o fuso local
        const getLocalISO = (dateStr) => {
            const d = new Date(dateStr);
            const offset = -d.getTimezoneOffset();
            const sign = offset >= 0 ? '+' : '-';
            const hours = Math.floor(Math.abs(offset) / 60).toString().padStart(2, '0');
            const mins = (Math.abs(offset) % 60).toString().padStart(2, '0');
            return `${dateStr}:00${sign}${hours}:${mins}`;
        };

        const startISO = getLocalISO(start);
        const endISO = getLocalISO(end);

        const { error } = await _supabase.from('reservations').insert([
            { user_id: currentUser.id, room_number: parseInt(room), start_time: startISO, end_time: endISO }
        ]);

        if (error) {
            if (error.code === '23P01') {
                toast("Esta sala já está reservada para este horário!", "error");
            } else {
                console.error("Erro Supabase Insert:", error);
                toast("Erro ao salvar: " + error.message, "error");
            }
        } else {
            console.log("✅ Reserva salva com sucesso!");
            toast("Reserva concluída!", "success");
            closeBookingModal();
            if (calendar) calendar.refetchEvents();
        }
    } catch (err) {
        console.error("❌ Erro inesperado em saveReservation:", err);
        toast("Ocorreu um erro técnico. Verifique o console.", "error");
    } finally {
        btn.disabled = false;
        btn.textContent = 'Confirmar';
    }
}

// =============================================
//  USERS CRUD (admin only)
// =============================================
async function loadUsers() {
    if (currentRole !== 'admin') return;

    const { data, error } = await _supabase
        .from('profiles')
        .select('*')
        .order('full_name', { ascending: true });

    if (error) {
        toast('Erro ao carregar usuários: ' + error.message, 'error');
        return;
    }

    allUsers = data || [];
    renderUsers(allUsers);
    updateStats(allUsers);
}

function updateStats(users) {
    document.getElementById('stat-total').textContent = users.length;
    document.getElementById('stat-active').textContent = users.filter(u => u.status !== 'inactive').length;
    document.getElementById('stat-admins').textContent = users.filter(u => u.role === 'admin').length;
    document.getElementById('users-count').textContent = `(${users.length})`;
}

function renderUsers(users) {
    const tbody = document.getElementById('users-tbody');

    if (!users.length) {
        tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><div class="empty-icon">👥</div><p>Nenhum usuário encontrado</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = users.map(user => {
        const initials = getInitials(user.full_name);
        const role = user.role || 'bp';
        const status = user.status || 'active';
        const isCurrentUser = currentUser && user.id === currentUser.id;

        return `
            <tr>
                <td>
                    <div class="user-cell">
                        <div class="avatar-sm">${initials}</div>
                        <div>
                            <div class="name">${escapeHtml(user.full_name || '—')}</div>
                            <div class="email">${escapeHtml(user.email || '—')}</div>
                        </div>
                    </div>
                </td>
                <td><span class="badge badge-${role}">${role.toUpperCase()}</span></td>
                <td><span class="badge badge-${status === 'active' ? 'active' : 'inactive'}">${status === 'active' ? '● Ativo' : '● Inativo'}</span></td>
                <td>
                    <div class="actions-cell">
                        <button class="btn btn-secondary btn-icon" title="Editar" onclick="editUser('${user.id}')">✏️</button>
                        ${!isCurrentUser ? `
                            <button class="btn btn-icon ${status === 'active' ? 'btn-danger' : 'btn-secondary'}" 
                                    title="${status === 'active' ? 'Desativar' : 'Ativar'}" 
                                    onclick="toggleUserStatus('${user.id}', '${status}')">
                                ${status === 'active' ? '🚫' : '✅'}
                            </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function filterUsers() {
    const query = document.getElementById('user-search').value.toLowerCase().trim();
    if (!query) {
        renderUsers(allUsers);
        return;
    }
    const filtered = allUsers.filter(u =>
        (u.full_name || '').toLowerCase().includes(query) ||
        (u.email || '').toLowerCase().includes(query)
    );
    renderUsers(filtered);
}

// ---- User Modal ----
function openUserModal() {
    editingUserId = null;
    document.getElementById('user-modal-title').textContent = '👤 Novo Usuário';
    document.getElementById('user-fullname').value = '';
    document.getElementById('user-email').value = '';
    document.getElementById('user-password').value = '';
    document.getElementById('user-role').value = 'bp';
    document.getElementById('user-status').value = 'active';
    document.getElementById('user-email-row').style.display = 'block';
    document.getElementById('user-password-row').style.display = 'block';
    document.getElementById('user-modal').classList.add('visible');
}

function editUser(userId) {
    const user = allUsers.find(u => u.id === userId);
    if (!user) return;

    editingUserId = userId;
    document.getElementById('user-modal-title').textContent = '✏️ Editar Usuário';
    document.getElementById('user-fullname').value = user.full_name || '';
    document.getElementById('user-email').value = user.email || '';
    document.getElementById('user-role').value = user.role || 'bp';
    document.getElementById('user-status').value = user.status || 'active';

    // Hide email and password for editing (can't change auth email easily)
    document.getElementById('user-email-row').style.display = 'none';
    document.getElementById('user-password-row').style.display = 'none';

    document.getElementById('user-modal').classList.add('visible');
}

function closeUserModal() {
    document.getElementById('user-modal').classList.remove('visible');
    editingUserId = null;
}

async function saveUser() {
    const fullName = document.getElementById('user-fullname').value.trim();
    const role = document.getElementById('user-role').value;
    const status = document.getElementById('user-status').value;
    const btn = document.getElementById('btn-save-user');

    if (!fullName) {
        toast('Nome é obrigatório.', 'error');
        return;
    }

    btn.classList.add('btn-loading');
    btn.disabled = true;

    try {
        if (editingUserId) {
            // UPDATE
            const { error } = await _supabase
                .from('profiles')
                .update({ full_name: fullName, role, status })
                .eq('id', editingUserId);

            if (error) throw error;
            toast('Usuário atualizado!', 'success');
        } else {
            // CREATE
            const email = document.getElementById('user-email').value.trim();
            const password = document.getElementById('user-password').value;

            if (!email) { toast('E-mail é obrigatório.', 'error'); btn.classList.remove('btn-loading'); btn.disabled = false; return; }
            if (!password || password.length < 6) { toast('Senha deve ter no mínimo 6 caracteres.', 'error'); btn.classList.remove('btn-loading'); btn.disabled = false; return; }

            // Usar um cliente temporário impede que o "signUp" deslogue o Admin atual!
            const _tempClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
                auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
            });

            const { data: signUpData, error: signUpError } = await _tempClient.auth.signUp({
                email,
                password,
                options: {
                    data: { full_name: fullName }
                }
            });

            if (signUpError) {
                if (signUpError.message.includes('User already registered')) {
                    toast('Usuário já cadastrado no Auth.', 'error');
                } else {
                    throw signUpError;
                }
                btn.classList.remove('btn-loading');
                btn.disabled = false;
                return;
            }

            // O perfil é criado pela trigger (no DB), então damos um leve delay e atualizamos para a role certa
            if (signUpData.user) {
                await new Promise(resolve => setTimeout(resolve, 1000));

                const { error: updateError } = await _supabase
                    .from('profiles')
                    .update({ full_name: fullName, role, status, email })
                    .eq('id', signUpData.user.id);

                if (updateError) {
                    console.warn('Profile update after creation:', updateError);
                    // Fallback
                    await _supabase.from('profiles').upsert({ id: signUpData.user.id, full_name: fullName, email, role, status });
                }
            }

            toast('Usuário criado com sucesso!', 'success');
        }

        closeUserModal();
        loadUsers();
    } catch (err) {
        toast('Erro: ' + (err.message || err), 'error');
        console.error(err);
    }

    btn.classList.remove('btn-loading');
    btn.disabled = false;
}

async function toggleUserStatus(userId, currentStatus) {
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
    const action = newStatus === 'inactive' ? 'desativar' : 'ativar';
    const user = allUsers.find(u => u.id === userId);

    openConfirmModal(
        `${newStatus === 'inactive' ? '🚫' : '✅'} ${action.charAt(0).toUpperCase() + action.slice(1)} Usuário`,
        `Deseja ${action} o usuário <span class="confirm-highlight">${escapeHtml(user?.full_name || '')}</span>?`,
        async () => {
            const { error } = await _supabase
                .from('profiles')
                .update({ status: newStatus })
                .eq('id', userId);

            if (error) {
                toast('Erro: ' + error.message, 'error');
            } else {
                toast(`Usuário ${action === 'desativar' ? 'desativado' : 'ativado'}!`, 'success');
                loadUsers();
            }
        }
    );
}

// =============================================
//  CONFIRM MODAL
// =============================================
let confirmCallback = null;

function openConfirmModal(title, text, callback) {
    document.getElementById('confirm-title').innerHTML = title;
    document.getElementById('confirm-text').innerHTML = text;
    confirmCallback = callback;

    const btn = document.getElementById('btn-confirm-action');
    
    // Removemos eventos antigos clonando o botão (técnica limpa para resetar listeners)
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    
    newBtn.addEventListener('click', async () => {
        console.log("Botão de confirmação clicado! Executando callback...");
        try {
            if (confirmCallback) {
                await confirmCallback();
            }
        } catch (error) {
            console.error("Erro no callback de confirmação:", error);
        } finally {
            closeConfirmModal();
        }
    });

    document.getElementById('confirm-modal').classList.add('visible');
}

function closeConfirmModal() {
    document.getElementById('confirm-modal').classList.remove('visible');
    confirmCallback = null;
}

// =============================================
//  UTILITIES
// =============================================
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// =============================================
//  ROOM DETAILS & PHOTOS
// =============================================
const ROOM_DETAILS = {
    1: {
        name: "Sala de Reunião 1",
        description: "Ambiente moderno e minimalista, ideal para reuniões rápidas e brainstorms em pequenos grupos. Equipada com tecnologia de ponta para videoconferências.",
        image: "meeting_room_1_1776372923543.png",
        features: ["4 Lugares", "TV 50\"", "Quadro Branco", "Ar Condicionado"]
    },
    2: {
        name: "Sala de Reunião 2",
        description: "Espaço versátil com excelente iluminação natural, perfeito para apresentações e reuniões de equipe de médio porte.",
        image: "meeting_room_2_1776373055517.png",
        features: ["6 Lugares", "TV 55\"", "Janelas Amplas", "Wi-Fi dedicado"]
    },
    3: {
        name: "Sala de Reunião 3 (Interna Comercial)",
        description: "Nossa sala premium com acabamento executivo. Ideal para fechamento de negócios e recepção de clientes VIP. Conta com estação de café privativa.",
        image: "meeting_room_3_premium_1776373088230.png",
        features: ["6 Lugares", "TV 65\"", "Cafeteira Premium", "Vista Panorâmica", "Isolamento Acústico"]
    },
    4: {
        name: "Sala de Reunião 4",
        description: "Ambiente focado em produtividade, com layout otimizado para sessões de trabalho colaborativo.",
        image: "meeting_room_2_1776373055517.png",
        features: ["6 Lugares", "TV 50\"", "Ar Condicionado", "Porta USB em mesa"]
    },
    5: {
        name: "Sala de Reunião 5",
        description: "Conforto e privacidade para reuniões estratégicas. Equipada com sistema de som integrado.",
        image: "meeting_room_1_1776372923543.png",
        features: ["6 Lugares", "TV 50\"", "Cortinas Blackout", "Quadro de Vidro"]
    },
    6: {
        name: "Sala de Reunião 6",
        description: "Ideal para conversas privadas, entrevistas ou chamadas confidencias. Compacta e aconchegante.",
        image: "meeting_room_1_1776372923543.png",
        features: ["3 Lugares", "TV 43\"", "Design Minimalista", "Tomadas Internas"]
    }
};

function openRoomDetails(roomId) {
    const room = ROOM_DETAILS[roomId];
    if (!room) return;

    document.getElementById('room-modal-image').src = room.image;
    document.getElementById('room-modal-title').textContent = room.name;
    document.getElementById('room-modal-description').textContent = room.description;
    
    const featuresList = document.getElementById('room-modal-features');
    featuresList.innerHTML = room.features.map(f => `<span class="badge badge-user">${f}</span>`).join('');
    
    document.getElementById('room-details-modal').classList.add('visible');
}

function closeRoomDetails() {
    document.getElementById('room-details-modal').classList.remove('visible');
}