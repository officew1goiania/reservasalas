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
            } else if (fetchError) {
                // Se houver instabilidade no banco de dados, NÃO forçar logout!
                // Mantenha o usuário com um perfil temporário seguro para continuar operando.
                console.warn("⚠️ Falha temporária no banco ao buscar perfil. Mantendo sessão ativa com perfil restrito.");
                
                const userName = currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || currentUser.email.split('@')[0];
                
                profile = {
                    id: currentUser.id,
                    full_name: userName,
                    email: currentUser.email,
                    role: 'bp', // Role mínima de segurança
                    status: 'active'
                };
            } else {
                // Se não for admin e não houver fetchError, o perfil legitimamente NÃO existe.
                console.warn("🚫 Usuário sem perfil no banco. Forçando logout.");
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
            const navBanners = document.getElementById('nav-banners');
            if (navBanners) {
                navBanners.style.display = (currentRole === 'admin') ? 'flex' : 'none';
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

        setupRealtimeListener();

        // Load global settings
        loadGlobalSettings();

    } else {
        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('app-screen').style.display = 'none';
        currentUser = null;
        currentProfile = null;
        currentRole = null;
        if (calendar) { calendar.destroy(); calendar = null; }
        removeRealtimeListener();
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
        if (page === 'banners') {
            if (currentRole !== 'admin') {
                navigateTo('agenda');
                return;
            }
            loadBannersConfigPage();
        }
        if (page === 'salas') {
            renderRooms();
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
            id, room_number, start_time, end_time, user_id, notes,
            profiles ( full_name )
        `);

    if (error) {
        console.warn("Erro ao buscar reservas com perfis:", error.message || error);

        // Se houver erro de recursão ou 500, tentamos buscar apenas os dados brutos de reserva
        if (error.message.includes('recursion') || error.status === 500 || error.code === 'PGRST500') {
            console.log("🛠 Iniciando fallback: buscando reservas sem detalhes de perfil...");
            const { data: fallbackData, error: fallbackError } = await _supabase
                .from('reservations')
                .select('id, room_number, start_time, end_time, user_id, notes');

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
            extendedProps: { 
                user_id: res.user_id, 
                room_number: res.room_number,
                user_name: userName,
                notes: res.notes || ''
            }
        };
    });

    successCallback(events);
}

function getRoomColor(room) {
    return ROOM_DETAILS[room]?.color || '#6366f1';
}

async function handleEventClick(info) {
    const event = info.event;
    const userId = event.extendedProps.user_id;
    const userName = event.extendedProps.user_name || 'Usuário';
    const roomNumber = event.extendedProps.room_number;
    const notes = event.extendedProps.notes || '';

    const roomInfo = ROOM_DETAILS[roomNumber];
    const roomName = roomInfo ? roomInfo.name : `Sala ${roomNumber}`;

    // Helper para formatar data local
    const formatDate = (date) => {
        if (!date) return '—';
        return new Date(date).toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    // Preencher campos do modal de detalhes
    document.getElementById('view-res-room').textContent = roomName;
    document.getElementById('view-res-user').textContent = userName;
    document.getElementById('view-res-start').textContent = formatDate(event.start);
    document.getElementById('view-res-end').textContent = formatDate(event.end);
    
    const notesEl = document.getElementById('view-res-notes');
    if (notes) {
        notesEl.textContent = notes;
        notesEl.style.fontStyle = 'normal';
        notesEl.style.color = 'var(--text-primary)';
    } else {
        notesEl.textContent = 'Nenhuma observação informada.';
        notesEl.style.fontStyle = 'italic';
        notesEl.style.color = 'var(--text-muted)';
    }

    // Configurar botão de cancelamento dependendo de quem está logado
    const cancelBtn = document.getElementById('btn-cancel-reservation');
    const isOwnerOrAdmin = currentUser && (currentUser.id === userId || currentRole === 'admin');
    
    if (isOwnerOrAdmin) {
        cancelBtn.style.display = 'inline-flex';
        // Resetar listeners clonando o botão
        const newCancelBtn = cancelBtn.cloneNode(true);
        cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
        newCancelBtn.addEventListener('click', () => {
            closeReservationDetailsModal();
            confirmCancelReservation(event);
        });
    } else {
        cancelBtn.style.display = 'none';
    }

    // Exibir o modal de detalhes
    document.getElementById('reservation-details-modal').classList.add('visible');
}

function closeReservationDetailsModal() {
    document.getElementById('reservation-details-modal').classList.remove('visible');
}

function confirmCancelReservation(event) {
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
function setupRoomSelect(selectedId = null) {
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
        if (selectedId && parseInt(selectedId) === id) {
            opt.selected = true;
        }
        select.appendChild(opt);
    });
}

function openBookingModal(roomId = null) {
    setupRoomSelect(roomId);
    document.getElementById('booking-modal').classList.add('visible');
}

// =============================================
//  BANNERS SYSTEM & SETTINGS
// =============================================

let topBannerConfig = { active: false, url: '', link: '' };
let sidebarBannerConfig = { active: false, url: '', link: '' };
let storageBucketName = 'banners'; // Default, resolved dynamically on start

async function loadGlobalSettings() {
    try {
        console.log("🔍 Carregando configurações de banners...");

        // Detectar o caso correto do bucket 'banners' no Supabase Storage
        try {
            const { data: buckets } = await _supabase.storage.listBuckets();
            if (buckets) {
                const matched = buckets.find(b => b.name.toLowerCase() === 'banners');
                if (matched) {
                    storageBucketName = matched.name;
                    console.log(`[Storage] Caso do bucket detectado: ${storageBucketName}`);
                }
            }
        } catch (bucketErr) {
            console.warn("[Storage] Falha ao detectar buckets na inicialização:", bucketErr);
        }
        
        // 1. Carregar Banner do Topo
        const { data: topData, error: topError } = await _supabase
            .from('app_settings')
            .select('value')
            .eq('key', 'top_banner_config')
            .maybeSingle();

        if (topError) {
            console.warn("Erro ao carregar top_banner_config:", topError.message);
        } else if (topData && topData.value) {
            topBannerConfig = topData.value;
            applyTopBannerConfig(topBannerConfig);
        } else {
            applyTopBannerConfig({ active: false, url: '', link: '' });
        }

        // 2. Carregar Banner Lateral
        const { data: sidebarData, error: sidebarError } = await _supabase
            .from('app_settings')
            .select('value')
            .eq('key', 'sidebar_banner_config')
            .maybeSingle();

        if (sidebarError) {
            console.warn("Erro ao carregar sidebar_banner_config:", sidebarError.message);
        } else if (sidebarData && sidebarData.value) {
            sidebarBannerConfig = sidebarData.value;
            applySidebarBannerConfig(sidebarBannerConfig);
        } else {
            applySidebarBannerConfig({ active: false, url: '', link: '' });
        }

    } catch (err) {
        console.error("Exceção ao carregar configurações globais:", err);
    }
}

function applyTopBannerConfig(config) {
    const container = document.getElementById('agenda-top-banner-container');
    const imgEl = document.getElementById('agenda-top-banner-img');
    const linkEl = document.getElementById('agenda-top-banner-link');

    if (!container || !imgEl || !linkEl) return;

    const isActive = config && (config.active === true || String(config.active) === 'true');
    if (isActive && config.url) {
        imgEl.src = config.url;
        if (config.link) {
            linkEl.href = config.link;
            linkEl.style.pointerEvents = 'auto';
        } else {
            linkEl.removeAttribute('href');
            linkEl.style.pointerEvents = 'none';
        }
        container.classList.remove('hidden');
    } else {
        container.classList.add('hidden');
        imgEl.src = '';
    }
}

function applySidebarBannerConfig(config) {
    const container = document.getElementById('sidebar-banner-container');
    const imgEl = document.getElementById('sidebar-banner-img');
    const linkEl = document.getElementById('sidebar-banner-link');

    if (!container || !imgEl || !linkEl) return;

    const isActive = config && (config.active === true || String(config.active) === 'true');
    if (isActive && config.url) {
        imgEl.src = config.url;
        if (config.link) {
            linkEl.href = config.link;
            linkEl.style.pointerEvents = 'auto';
        } else {
            linkEl.removeAttribute('href');
            linkEl.style.pointerEvents = 'none';
        }
        container.classList.remove('hidden');
    } else {
        container.classList.add('hidden');
        imgEl.src = '';
    }
}

async function loadBannersConfigPage() {
    try {
        console.log("📂 Carregando página administrativa de banners...");

        // Verificar se o bucket 'banners' existe no Supabase Storage
        try {
            const { data: buckets, error: bucketsErr } = await _supabase.storage.listBuckets();
            if (bucketsErr) {
                console.warn("Erro ao listar buckets de storage:", bucketsErr.message);
            } else {
                const matched = buckets && buckets.find(b => b.name.toLowerCase() === 'banners');
                if (matched) {
                    storageBucketName = matched.name;
                    console.log(`[Storage] Caso do bucket detectado: ${storageBucketName}`);
                } else {
                    toast("Aviso: O bucket público 'banners' não foi criado no Supabase Storage. Crie-o para habilitar upload.", "error");
                }
            }
        } catch (storageErr) {
            console.warn("Não foi possível validar a existência de buckets de storage:", storageErr);
        }
        
        const { data: settings, error } = await _supabase
            .from('app_settings')
            .select('*')
            .in('key', ['top_banner_config', 'sidebar_banner_config']);

        if (error) {
            toast("Erro ao buscar configurações: " + error.message, "error");
            return;
        }

        // Resetar formulário
        document.getElementById('top-banner-active').checked = false;
        document.getElementById('top-banner-url').value = '';
        document.getElementById('top-banner-link').value = '';
        updateBannerPreview('top');

        document.getElementById('sidebar-banner-active').checked = false;
        document.getElementById('sidebar-banner-url').value = '';
        document.getElementById('sidebar-banner-link').value = '';
        updateBannerPreview('sidebar');

        if (settings) {
            settings.forEach(item => {
                const config = item.value;
                if (!config) return;
                
                if (item.key === 'top_banner_config') {
                    document.getElementById('top-banner-active').checked = (config.active === true || String(config.active) === 'true');
                    document.getElementById('top-banner-url').value = config.url || '';
                    document.getElementById('top-banner-link').value = config.link || '';
                    updateBannerPreview('top');
                } else if (item.key === 'sidebar_banner_config') {
                    document.getElementById('sidebar-banner-active').checked = (config.active === true || String(config.active) === 'true');
                    document.getElementById('sidebar-banner-url').value = config.url || '';
                    document.getElementById('sidebar-banner-link').value = config.link || '';
                    updateBannerPreview('sidebar');
                }
            });
        }
    } catch (err) {
        console.error("Erro na página de banners:", err);
        toast("Erro ao inicializar página de banners.", "error");
    }
}

function updateBannerPreview(type) {
    const urlInput = document.getElementById(`${type}-banner-url`);
    const imgEl = document.getElementById(`${type}-banner-preview`);
    const placeholderEl = document.getElementById(`${type}-banner-preview-placeholder`);

    if (!urlInput || !imgEl || !placeholderEl) return;

    const url = urlInput.value.trim();
    if (url) {
        imgEl.src = url;
        imgEl.classList.remove('hidden');
        placeholderEl.classList.add('hidden');
    } else {
        imgEl.src = '';
        imgEl.classList.add('hidden');
        placeholderEl.classList.remove('hidden');
    }
}

async function saveSingleBanner(type, event) {
    const active = document.getElementById(`${type}-banner-active`).checked;
    const url = document.getElementById(`${type}-banner-url`).value.trim();
    const link = document.getElementById(`${type}-banner-link`).value.trim();

    if (active && !url) {
        toast("Por favor, preencha a URL da imagem antes de ativar o banner.", "error");
        return;
    }

    const key = (type === 'top') ? 'top_banner_config' : 'sidebar_banner_config';
    const config = { active, url, link };

    try {
        const evt = event || window.event;
        const btn = evt ? (evt.currentTarget || evt.target) : null;
        const originalText = btn ? btn.textContent : 'Salvar';
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Salvando...';
        }

        const { error } = await _supabase
            .from('app_settings')
            .upsert({ key, value: config }, { onConflict: 'key' });

        if (btn) {
            btn.disabled = false;
            btn.textContent = originalText;
        }

        if (error) {
            console.error(`Erro Supabase ao salvar banner ${type}:`, error);
            toast("Erro ao salvar no banco de dados: " + error.message, "error");
        } else {
            toast("Configuração salva com sucesso!", "success");
            
            // Aplicar localmente e de imediato na UI
            if (type === 'top') {
                topBannerConfig = config;
                applyTopBannerConfig(config);
            } else if (type === 'sidebar') {
                sidebarBannerConfig = config;
                applySidebarBannerConfig(config);
            }
        }
    } catch (err) {
        console.error("Exceção ao salvar banner:", err);
        toast("Erro técnico ao salvar.", "error");
    }
}

async function handleBannerFileUpload(type) {
    const fileInput = document.getElementById(`${type}-banner-file`);
    const filenameLabel = document.getElementById(`${type}-banner-filename`);
    const urlInput = document.getElementById(`${type}-banner-url`);
    const uploadBtn = document.getElementById(`${type}-banner-upload-btn`);

    console.log(`[Upload] Iniciando processo para o tipo: ${type}`);

    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        console.warn("[Upload] Nenhum arquivo selecionado ou inputs não encontrados.");
        return;
    }

    const file = fileInput.files[0];
    console.log("[Upload] Detalhes do arquivo selecionado:", {
        nome: file.name,
        tamanho: file.size,
        tipo: file.type
    });

    if (filenameLabel) {
        filenameLabel.textContent = file.name;
    }

    const originalBtnText = uploadBtn ? uploadBtn.textContent : 'Carregar Imagem';
    if (uploadBtn) {
        uploadBtn.disabled = true;
        uploadBtn.textContent = 'Enviando...';
    }

    try {
        const fileExt = file.name.split('.').pop();
        const fileName = `${type}_banner_${Date.now()}.${fileExt}`;
        const filePath = `${fileName}`;
        console.log(`[Upload] Preparando upload para o caminho: ${filePath}`);

        if (!_supabase) {
            console.error("[Upload] Supabase client não está inicializado!");
            throw new Error("Cliente Supabase não inicializado.");
        }

        console.log(`[Upload] Chamando _supabase.storage.from('${storageBucketName}').upload...`);
        const { data, error } = await _supabase.storage
            .from(storageBucketName)
            .upload(filePath, file, {
                cacheControl: '3600',
                upsert: false
            });

        console.log("[Upload] Chamada finalizada. Resposta do Supabase:", { data, error });

        if (error) {
            console.error("[Upload] Erro retornado pelo Supabase Storage:", error);
            if (error.message && (error.message.includes('bucket') || error.message.includes('Bucket'))) {
                toast("Erro: Certifique-se de que o bucket público 'banners' foi criado no Supabase.", "error");
            } else {
                toast("Erro no upload: " + error.message, "error");
            }
            if (filenameLabel) {
                filenameLabel.textContent = 'Falha no envio';
            }
            return;
        }

        console.log("[Upload] Obtendo URL pública do arquivo...");
        const { data: publicUrlData } = _supabase.storage
            .from(storageBucketName)
            .getPublicUrl(filePath);

        const publicUrl = publicUrlData.publicUrl;
        console.log(`[Upload] URL pública obtida: ${publicUrl}`);

        if (urlInput) {
            urlInput.value = publicUrl;
            console.log("[Upload] URL input atualizada com sucesso.");
        }
        updateBannerPreview(type);

        toast("Upload concluído com sucesso!", "success");
    } catch (err) {
        console.error("[Upload] Exceção crítica durante upload do banner:", err);
        toast("Erro técnico durante o upload: " + (err.message || err), "error");
        if (filenameLabel) {
            filenameLabel.textContent = 'Erro no envio';
        }
    } finally {
        console.log("[Upload] Executando bloco finally para restaurar o estado do botão.");
        if (uploadBtn) {
            uploadBtn.disabled = false;
            uploadBtn.textContent = originalBtnText;
        }
    }
}



function closeBookingModal() {
    document.getElementById('booking-modal').classList.remove('visible');
    document.getElementById('start-time').value = '';
    document.getElementById('end-time').value = '';
    const notesEl = document.getElementById('booking-notes');
    if (notesEl) notesEl.value = '';
}

async function saveReservation() {
    const btn = document.querySelector('#booking-modal .btn-primary');

    try {
        const room = document.getElementById('room-select').value;
        const start = document.getElementById('start-time').value;
        const end = document.getElementById('end-time').value;
        const notes = document.getElementById('booking-notes') ? document.getElementById('booking-notes').value.trim() : '';

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

        console.log("💾 Salvando reserva...", { room, start, end, user_id: currentUser.id, notes });

        // Converte os horários locais do formulário para o formato ISO preservando o fuso local
        const getLocalISO = (dateStr) => {
            const d = new Date(dateStr);
            const offset = -d.getTimezoneOffset();
            const sign = offset >= 0 ? '+' : '-';
            const hours = Math.floor(Math.abs(offset) / 60).toString().padStart(2, '0');
            const mins = (Math.abs(offset) % 60).toString().padStart(2, '0');
            const pad = n => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00${sign}${hours}:${mins}`;
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
            toast("Erro técnico ao verificar disponibilidade. Verifique sua conexão.", "error");
            return;
        } else if (conflicts && conflicts.length > 0) {
            toast("Já existe uma reserva nesta sala para o horário selecionado!", "error");
            return;
        }

        const { error } = await _supabase.from('reservations').insert([
            { 
                user_id: currentUser.id, 
                room_number: parseInt(room), 
                start_time: startISO, 
                end_time: endISO,
                notes: notes || null
            }
        ]);

        if (error) {
            if (error.code === '23P01' || error.message.includes('overlap')) {
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
                            <button class="btn btn-danger btn-icon" 
                                    title="Excluir" 
                                    onclick="deleteUser('${user.id}')">
                                🗑️
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

async function deleteUser(userId) {
    const user = allUsers.find(u => u.id === userId);
    if (!user) return;

    openConfirmModal(
        `🗑️ Excluir Usuário`,
        `Deseja realmente excluir permanentemente o usuário <span class="confirm-highlight">${escapeHtml(user.full_name || '')}</span> do banco de dados?<br><br><span style="color: #f87171; font-size: 0.85rem;">⚠️ Atenção: Esta ação também excluirá todas as reservas associadas a este usuário.</span>`,
        async () => {
            try {
                // 1. Excluir reservas do usuário para evitar erro de chave estrangeira
                const { error: resError } = await _supabase
                    .from('reservations')
                    .delete()
                    .eq('user_id', userId);

                if (resError) {
                    console.error("Erro ao deletar reservas do usuário:", resError);
                    toast('Erro ao excluir reservas: ' + resError.message, 'error');
                    return;
                }

                // 2. Excluir perfil do usuário
                const { error: profileError } = await _supabase
                    .from('profiles')
                    .delete()
                    .eq('id', userId);

                if (profileError) {
                    console.error("Erro ao deletar perfil do usuário:", profileError);
                    toast('Erro ao excluir usuário: ' + profileError.message, 'error');
                } else {
                    toast('Usuário excluído com sucesso!', 'success');
                    loadUsers();
                }
            } catch (err) {
                console.error("Erro inesperado ao deletar usuário:", err);
                toast('Erro técnico ao excluir usuário. Verifique o console.', 'error');
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
        features: ["6 Lugares", "TV", "Janelas"],
        color: '#0d9488' // Teal
    },
    2: {
        name: "Sala de Reunião 2",
        description: "Office 1 - Sala ao centro, em frente à entrada",
        image: "meeting_room_2_1776373055517.png",
        features: ["6 Lugares", "TV", "Janelas"],
        color: '#6366f1' // Indigo
    },
    3: {
        name: "Sala de Reunião 3",
        description: "Office 1 - Sala interna na área comercial à direita",
        image: "meeting_room_3_premium_1776373088230.png",
        features: ["6 Lugares", "TV", "Janelas", "Cafeteira"],
        color: '#d4a853' // Gold
    },
    4: {
        name: "Sala de Reunião 4",
        description: "Office 2 - Sala à esquerda da entrada",
        image: "meeting_room_2_1776373055517.png",
        features: ["6 Lugares", "TV", "Janelas", "Acesso exclusivo para FA3+"],
        color: '#ec4899' // Pink
    },
    5: {
        name: "Sala de Reunião 5",
        description: "Office 2 - Sala ao centro da entrada",
        image: "meeting_room_1_1776372923543.png",
        features: ["6 Lugares", "TV", "Janelas", "Acesso exclusivo para FA3+"],
        color: '#f97316' // Orange
    },
    6: {
        name: "Sala de Reunião 6",
        description: "Office 2 - Sala à direita da entrada",
        image: "meeting_room_1_1776372923543.png",
        features: ["3 Lugares", "TV", "Acesso exclusivo para FA3+"],
        color: '#8b5cf6' // Violet
    },
    7: {
        name: "Phone Boot 1",
        description: "Phone Boot Direito",
        image: "phone_boot_1.png",
        features: ["Uso Individual", "Janelas", "Silencioso"],
        color: '#2dd4bf' // Bright Teal
    },
    8: {
        name: "Phone Boot 2",
        description: "Phone Boot Esquerdo",
        image: "phone_boot_2.png",
        features: ["Uso Individual", "Janelas", "Silencioso"],
        color: '#fbbf24' // Amber
    }
};

function openRoomDetails(roomId) {
    const room = ROOM_DETAILS[roomId];
    if (!room) return;

    document.getElementById('room-modal-image').src = room.image;
    document.getElementById('room-modal-title').textContent = room.name;
    document.getElementById('room-modal-description').textContent = room.description;
    
    // Atualiza o botão de reservar no modal de detalhes
    const reserveBtn = document.getElementById('btn-reserve-from-details');
    if (reserveBtn) {
        reserveBtn.onclick = () => {
            closeRoomDetails();
            navigateTo('agenda');
            openBookingModal(roomId);
        };
    }

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
                        <div class="room-card-header" style="border-left: 4px solid ${room.color}">
                            <div class="room-number" style="color: ${room.color}">${formattedId}</div>
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

// =============================================
//  SUPABASE REALTIME LISTENER
// =============================================

let realtimeChannel = null;

function setupRealtimeListener() {
    if (realtimeChannel) return; // Already listening

    console.log("📡 Ativando ouvinte Realtime do Supabase...");
    realtimeChannel = _supabase
        .channel('realtime-reservations')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, (payload) => {
            console.log("🔄 Alteração detectada no banco via Realtime:", payload);
            if (calendar) {
                calendar.refetchEvents();
            }
        })
        .subscribe((status) => {
            console.log(`📡 Status da conexão Realtime: ${status}`);
        });
}

function removeRealtimeListener() {
    if (realtimeChannel) {
        console.log("🔌 Desativando ouvinte Realtime...");
        _supabase.removeChannel(realtimeChannel);
        realtimeChannel = null;
    }
}