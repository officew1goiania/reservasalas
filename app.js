//  W1 Goiânia – Reservas  (app.js)
//  v8 - Fix Recursion Resilience
// =============================================
console.log("🚀 App loading - Version 8");

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

// Cliente auxiliar para criação de usuários (evita deslogar o admin)
let _signUpClient = null;
function getSignUpClient() {
    if (!_signUpClient) {
        _signUpClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false
            }
        });
    }
    return _signUpClient;
}

// Teste de conexão imediato
_supabase.from('profiles').select('count', { count: 'exact', head: true })
    .then(({ error }) => {
        if (error) {
            console.error("⚠️ Teste de conexão falhou:", error.message || error);
            // Se for erro 500, provavelmente é RLS ou Banco de Dados
            if (error.code === 'PGRST500' || (error.status >= 500)) {
                console.warn("Dica: Verifique as políticas de RLS ou se a tabela 'profiles' está correta.");
            }
        }
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

        // Tentar buscar o perfil
        let profile = null;
        let fetchError = null;

        try {
            const { data, error } = await _supabase
                .from('profiles')
                .select('*')
                .eq('id', currentUser.id)
                .maybeSingle(); // Usar maybeSingle() para evitar erro de '0 linhas' no log
            profile = data;
            fetchError = error;

            if (fetchError) {
                console.error("Erro ao buscar perfil:", fetchError);
            }
        } catch (e) {
            console.error("Exceção na busca de perfil:", e);
        }

        // Se não achou profile OU deu erro (como o 500 que estamos vendo), 
        // mas o usuário é Admin, tentamos recuperar.
        if (!profile) {
            console.log("ℹ️ Perfil não encontrado ou erro na busca. Verificando se é admin...");
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

                console.log("🛠 Tentando restaurar/criar perfil admin...");
                const { data: inserted, error: insertErr } = await _supabase
                    .from('profiles')
                    .upsert(newProfile)
                    .select()
                    .maybeSingle();

                if (insertErr) {
                    console.error('Erro ao recriar perfil admin:', insertErr);
                    // Fallback: usar o objeto local para não quebrar a UI
                    profile = newProfile;
                } else {
                    profile = inserted || newProfile;
                }
                toast(`Bem-vindo, Admin! Seu perfil foi restaurado.`, 'success');
            } else {
                // Se não for admin e deu erro/não achou, não podemos deixar entrar
                console.warn("🚫 Usuário sem perfil ou erro de banco. Forçando logout.");
                const msg = fetchError ? 'Erro de conexão com o banco (500). Contate o administrador.' : 'Seu acesso não foi liberado. Contate o administrador.';
                toast(msg, 'error');
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
        } else {
            // Fallback extremo
            toast('Erro ao carregar seu perfil.', 'error');
            await _supabase.auth.signOut();
            return;
        }

        // Update sidebar user info
        if (profile) {
            const userName = profile.full_name || currentUser.email || 'Usuário';
            const initials = getInitials(userName);

            const avatarEl = document.getElementById('sidebar-avatar');
            const nameEl = document.getElementById('sidebar-user-name');
            const roleEl = document.getElementById('sidebar-user-role');

            if (avatarEl) avatarEl.textContent = initials;
            if (nameEl) nameEl.textContent = userName;
            if (roleEl) roleEl.textContent = (currentRole || 'USER').toUpperCase();

            // Show/hide admin nav
            const navUsuarios = document.getElementById('nav-usuarios');
            if (navUsuarios) {
                navUsuarios.style.display = (currentRole === 'admin') ? 'flex' : 'none';
            }
            const navConfiguracoes = document.getElementById('nav-configuracoes');
            if (navConfiguracoes) {
                navConfiguracoes.style.display = (currentRole === 'admin') ? 'flex' : 'none';
            }
        } else {
            console.error("❌ Erro fatal: Tentativa de atualizar UI sem perfil carregado.");
        }

        // Switch screens
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app-screen').style.display = 'flex';

        // Init calendar
        setupRoomSelect();
        if (!calendar) initCalendar();
        else calendar.refetchEvents();
        
        // Load global settings
        loadGlobalSettings();

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
        if (page === 'salas') {
            renderRooms();
        }
        if (page === 'configuracoes' && currentRole === 'admin') {
            loadSettingsForm();
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
    let { data, error } = await _supabase
        .from('reservations')
        .select(`
            id, room_number, start_time, end_time, user_id,
            profiles ( full_name )
        `);

    if (error) {
        console.warn("Erro ao buscar reservas com perfis:", error.message || error);

        // Se houver erro de recursão ou 500, tentamos buscar apenas os dados brutos de reserva
        if (error.message.includes('recursion') || error.status === 500 || error.code === 'PGRST500') {
            console.log("🛠 Iniciando fallback: buscando reservas sem detalhes de perfil...");
            const { data: fallbackData, error: fallbackError } = await _supabase
                .from('reservations')
                .select('id, room_number, start_time, end_time, user_id');

            if (fallbackError) {
                console.error("Erro no fallback de reservas:", fallbackError);
                failureCallback(fallbackError);
                return;
            }
            data = fallbackData;
        } else {
            failureCallback(error);
            return;
        }
    }

    const events = (data || []).map(res => {
        const userName = res.profiles?.full_name || 'Usuário';
        return {
            id: res.id,
            title: `Sala ${res.room_number} — ${userName}`,
            start: res.start_time,
            end: res.end_time,
            backgroundColor: getRoomColor(res.room_number),
            extendedProps: { user_id: res.user_id, room_number: res.room_number }
        };
    });

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
    if (!select) return;
    select.innerHTML = '';

    // Salas normais baseadas na role + Phone Boots para todos
    const roomIds = (currentRole === 'bp') ? [1, 2, 3, 7, 8] : [1, 2, 3, 4, 5, 6, 7, 8];

    roomIds.forEach(id => {
        const opt = document.createElement('option');
        opt.value = id;
        const roomName = ROOM_DETAILS[id]?.name || `Sala ${id}`;
        opt.innerText = roomName;
        select.appendChild(opt);
    });
}

function openBookingModal() {
    document.getElementById('booking-modal').classList.add('visible');
}

// =============================================
//  EVENT POPUP CONTROLS & SETTINGS
// =============================================

function openEventPopup() {
    const popup = document.getElementById('event-popup');
    if (popup) popup.classList.add('visible');
}

function closeEventPopup() {
    const popup = document.getElementById('event-popup');
    if (popup) popup.classList.remove('visible');
}

let globalBannerConfig = { active: false, url: '', link: '' };

async function loadGlobalSettings() {
    try {
        const { data, error } = await _supabase
            .from('app_settings')
            .select('value')
            .eq('key', 'banner_config')
            .maybeSingle();

        if (error) {
            console.warn("Erro ao carregar configurações do banner (a tabela pode não existir ainda).", error.message);
            return;
        }

        if (data && data.value) {
            globalBannerConfig = data.value;
            applyBannerConfig(globalBannerConfig);
        }
    } catch (err) {
        console.error("Exceção ao carregar configurações:", err);
    }
}

function applyBannerConfig(config) {
    const imgEl = document.getElementById('event-banner-img');
    const linkEl = document.getElementById('event-banner-link');
    
    if (config.url) {
        imgEl.src = config.url;
    }
    
    if (config.link) {
        linkEl.href = config.link;
        linkEl.style.pointerEvents = 'auto';
    } else {
        linkEl.removeAttribute('href');
        linkEl.style.pointerEvents = 'none';
    }

    if (config.active && String(config.active) === 'true') {
        openEventPopup();
    }
}

function loadSettingsForm() {
    document.getElementById('config-banner-active').value = String(globalBannerConfig.active === true);
    document.getElementById('config-banner-url').value = globalBannerConfig.url || '';
    document.getElementById('config-banner-link').value = globalBannerConfig.link || '';
}

async function saveSettings() {
    const btn = document.getElementById('btn-save-settings');
    btn.disabled = true;
    btn.textContent = 'Salvando...';

    const newConfig = {
        active: document.getElementById('config-banner-active').value === 'true',
        url: document.getElementById('config-banner-url').value.trim(),
        link: document.getElementById('config-banner-link').value.trim()
    };

    try {
        const { error } = await _supabase
            .from('app_settings')
            .upsert({ key: 'banner_config', value: newConfig });

        if (error) {
            toast('Erro ao salvar. Verifique se a tabela app_settings existe.', 'error');
            console.error(error);
        } else {
            toast('Configurações salvas com sucesso!', 'success');
            globalBannerConfig = newConfig;
            applyBannerConfig(newConfig);
        }
    } catch (err) {
        toast('Erro inesperado ao salvar.', 'error');
        console.error(err);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Salvar Configurações';
    }
}

function testBanner() {
    const testConfig = {
        active: true,
        url: document.getElementById('config-banner-url').value.trim() || 'event_banner.png',
        link: document.getElementById('config-banner-link').value.trim()
    };
    applyBannerConfig(testConfig);
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

        // --- NOVO: Verificação de Conflito Manual ---
        console.log("🔍 Verificando disponibilidade...");
        const { data: conflicts, error: conflictError } = await _supabase
            .from('reservations')
            .select('id')
            .eq('room_number', parseInt(room))
            .lt('start_time', endISO)
            .gt('end_time', startISO);

        if (conflictError) {
            console.error("Erro ao verificar conflitos:", conflictError);
        } else if (conflicts && conflicts.length > 0) {
            toast("Já existe uma reserva nesta sala para o horário selecionado!", "error");
            closeBookingModal(); // Fecha o modal conforme solicitado
            return;
        }

        const { error } = await _supabase.from('reservations').insert([
            { user_id: currentUser.id, room_number: parseInt(room), start_time: startISO, end_time: endISO }
        ]);

        if (error) {
            if (error.code === '23P01' || error.message.includes('overlap')) {
                toast("Esta sala já está reservada para este horário!", "error");
                closeBookingModal();
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

    try {
        const { data, error } = await _supabase
            .from('profiles')
            .select('*')
            .order('full_name', { ascending: true });

        if (error) {
            console.error("Erro ao carregar usuários:", error);
            if (error.message.includes('recursion') || error.status === 500) {
                toast('Erro de configuração no banco (Recursão RLS).', 'error');
            } else {
                toast('Erro ao carregar usuários: ' + error.message, 'error');
            }
            allUsers = [];
        } else {
            allUsers = data || [];
        }
    } catch (err) {
        console.error("Exceção ao carregar usuários:", err);
        allUsers = [];
    }

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
        const errorMsg = currentRole === 'admin' && allUsers.length === 0 ?
            "Erro ao carregar do banco. Verifique as políticas de segurança (RLS)." :
            "Nenhum usuário encontrado";

        tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><div class="empty-icon">⚠️</div><p>${errorMsg}</p></div></td></tr>`;
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

            if (!email) {
                toast('E-mail é obrigatório.', 'error');
                btn.classList.remove('btn-loading');
                btn.disabled = false;
                return;
            }
            if (!password || password.length < 6) {
                toast('Senha deve ter no mínimo 6 caracteres.', 'error');
                btn.classList.remove('btn-loading');
                btn.disabled = false;
                return;
            }

            // Usar um cliente singleton para signUp evita múltiplos avisos no console
            const _tempClient = getSignUpClient();

            const { data: signUpData, error: signUpError } = await _tempClient.auth.signUp({
                email,
                password,
                options: {
                    data: { full_name: fullName }
                }
            });

            if (signUpError) {
                if (signUpError.message.includes('User already registered')) {
                    toast('Este e-mail já está cadastrado.', 'error');
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
        description: "Office 1 - Sala à direita da entrada",
        image: "meeting_room_1_1776372923543.png",
        features: ["6 Lugares", "TV", "Janelas"]
    },
    2: {
        name: "Sala de Reunião 2",
        description: "Office 1 - Sala ao centro, em frente à entrada",
        image: "meeting_room_2_1776373055517.png",
        features: ["6 Lugares", "TV", "Janelas"]
    },
    3: {
        name: "Sala de Reunião 3",
        description: "Office 1 - Sala interna na área comercial à direita",
        image: "meeting_room_3_premium_1776373088230.png",
        features: ["6 Lugares", "TV", "Janelas", "Cafeteira"]
    },
    4: {
        name: "Sala de Reunião 4",
        description: "Office 2 - Sala à esquerda da entrada",
        image: "meeting_room_2_1776373055517.png",
        features: ["6 Lugares", "TV", "Janelas", "Acesso exclusivo para FA3+"]
    },
    5: {
        name: "Sala de Reunião 5",
        description: "Office 2 - Sala ao centro da entrada",
        image: "meeting_room_1_1776372923543.png",
        features: ["6 Lugares", "TV", "Janelas", "Acesso exclusivo para FA3+"]
    },
    6: {
        name: "Sala de Reunião 6",
        description: "Office 2 - Sala à direita da entrada",
        image: "meeting_room_1_1776372923543.png",
        features: ["3 Lugares", "TV", "Acesso exclusivo para FA3+"]
    },
    7: {
        name: "Phone Boot 1",
        description: "Phone Boot Direito",
        image: "phone_boot_1.png",
        features: ["Uso Individual", "Janelas", "Silencioso"]
    },
    8: {
        name: "Phone Boot 2",
        description: "Phone Boot Esquerdo",
        image: "phone_boot_2.png",
        features: ["Uso Individual", "Janelas", "Silencioso"]
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

function renderRooms() {
    const grid = document.getElementById('rooms-grid');
    if (!grid) return;

    const icons = {
        "Lugares": "👥",
        "TV": "📺",
        "Janelas": "🪟",
        "Quadro": "📝",
        "Ar Condicionado": "❄️",
        "Wi-Fi": "📶",
        "Cafeteira": "☕",
        "Vista": "🏙️",
        "Isolamento": "🔇",
        "Design": "🎨",
        "Tomadas": "🔌"
    };

    const getIcon = (feature) => {
        for (const [key, icon] of Object.entries(icons)) {
            if (feature.toLowerCase().includes(key.toLowerCase())) return icon;
        }
        return "✨";
    };

    grid.innerHTML = Object.entries(ROOM_DETAILS).map(([id, room]) => {
        const isFeatured = id === "3"; // Match existing logic
        const formattedId = id.padStart(2, '0');

        const featuresHtml = room.features.slice(0, 3).map(f => `
            <div class="feature"><span class="f-icon">${getIcon(f)}</span> ${f}</div>
        `).join('');

        return `
            <div class="room-card-container" onclick="openRoomDetails(${id})">
                <div class="room-card">
                    <!-- FRONT -->
                    <div class="room-card-front ${isFeatured ? 'featured' : ''}">
                        ${isFeatured ? '<span class="badge-gold">Interna Comercial</span>' : ''}
                        <div class="room-card-header">
                            <div class="room-number">${formattedId}</div>
                            <h3>${room.name}</h3>
                        </div>
                        <div class="room-features">
                            ${featuresHtml}
                        </div>
                    </div>
                    <!-- BACK -->
                    <div class="room-card-back">
                        <img src="${room.image}" class="room-back-image" alt="${room.name}">
                        <div class="room-back-overlay">
                            <div class="room-back-info">
                                <h4>${room.name}</h4>
                                <p>${room.description}</p>
                                <button class="btn btn-primary btn-card-back btn-full">
                                    Ver Detalhes
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}