import React, { useState, useEffect, useRef } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

// Configuration API
// Utilise toujours le proxy nginx (/api) qui redirige vers le backend
// Cela fonctionne aussi bien en développement qu'en production
const API_URL = process.env.REACT_APP_API_URL || '/api';

/** URL pour afficher un fichier uploadé (signature, logo, etc.). Toujours l’URL complète du backend
 *  pour éviter les 500 du proxy ; le backend envoie CORP: cross-origin pour autoriser l’affichage.
 *  Aucun redimensionnement ni compression côté backend : le fichier est enregistré tel quel. */
function getUploadsDisplayUrl(relativePath, cacheBust) {
  if (!relativePath) return null;
  const p = relativePath.replace(/^uploads[\\/]/, '');
  const baseUrl = (API_URL || '').replace(/\/api\/?$/, '');
  const url = baseUrl ? `${baseUrl}/uploads/${p}` : `/uploads/${p}`;
  if (cacheBust) return `${url}?v=${encodeURIComponent(cacheBust)}`;
  return url;
}

// Service API
const api = {
  async get(endpoint) {
    const response = await fetch(`${API_URL}${endpoint}`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Erreur réseau' }));
      throw new Error(errorData.error || `Erreur ${response.status}: ${response.statusText}`);
    }
    return response.json();
  },
  async post(endpoint, data) {
    const response = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Erreur réseau');
    return response.json();
  },
  async put(endpoint, data) {
    const response = await fetch(`${API_URL}${endpoint}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Erreur réseau');
    return response.json();
  },
  async delete(endpoint) {
    const response = await fetch(`${API_URL}${endpoint}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Erreur réseau');
    return response.json();
  }
};

/** Retourne une URL de logo valide ou null (null, undefined, chaîne vide = pas de logo). */
function normalizeLogoUrl(url) {
  if (url == null) return null;
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Détermine comment afficher les logos en haut du PDF du devis.
 * Cas 1 : client + entreprise -> client gauche, entreprise droite, alignés.
 * Cas 2 : uniquement entreprise -> entreprise centrée.
 * Cas 3 : uniquement client -> ne rien afficher.
 * Cas 4 : aucun -> ne rien afficher.
 */
function getPdfLogoDisplay(companyLogoUrl, clientLogoUrl) {
  const company = normalizeLogoUrl(companyLogoUrl);
  const client = normalizeLogoUrl(clientLogoUrl);
  const hasCompanyLogo = !!company;
  const hasClientLogo = !!client;
  const showLogoHeader = hasCompanyLogo;
  const companyCenteredOnly = hasCompanyLogo && !hasClientLogo;
  const bothLogos = hasCompanyLogo && hasClientLogo;
  return {
    showLogoHeader,
    companyLogoUrl: company,
    clientLogoUrl: client,
    bothLogos,
    companyCenteredOnly
  };
}

/** Logo pour PDF : masqué si src absent ou si le chargement échoue (fallback = ne rien afficher). */
function PdfLogoImage({ src, alt, style }) {
  const [loadError, setLoadError] = useState(false);
  if (!src || loadError) return null;
  return (
    <img
      src={src}
      alt={alt}
      style={style}
      crossOrigin="anonymous"
      onError={() => setLoadError(true)}
    />
  );
}

// Composant principal
export default function App() {
  const [user, setUser] = useState(null);
  const [currentPage, setCurrentPage] = useState('login');
  const [darkMode, setDarkMode] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [quoteToOpen, setQuoteToOpen] = useState(null);

  const handleLogin = (userData) => {
    // Normaliser le rôle en minuscules
    const normalizedUser = {
      ...userData,
      role: (userData.role || 'lecteur').toLowerCase()
    };
    setUser(normalizedUser);
    setCurrentPage('dashboard');
    // Charger les notifications après connexion
    if (normalizedUser.id) {
      loadNotifications(normalizedUser.id);
      loadUnreadCount(normalizedUser.id);
    }
  };

  const loadNotifications = async (userId) => {
    try {
      const data = await api.get(`/notifications?userId=${userId}`);
      setNotifications(data);
    } catch (error) {
      console.error('Erreur chargement notifications:', error);
    }
  };

  const loadUnreadCount = async (userId) => {
    try {
      const data = await api.get(`/notifications/unread-count?userId=${userId}`);
      setUnreadCount(data.count);
    } catch (error) {
      console.error('Erreur comptage notifications:', error);
    }
  };

  const markNotificationAsRead = async (notificationId) => {
    try {
      await api.put(`/notifications/${notificationId}/read`);
      setNotifications(notifications.map(n => 
        n.id === notificationId ? {...n, read: true} : n
      ));
      setUnreadCount(Math.max(0, unreadCount - 1));
    } catch (error) {
      console.error('Erreur marquage notification:', error);
    }
  };

  const handleDeleteNotification = async (notificationId, e) => {
    e.stopPropagation(); // Empêcher le clic sur la notification
    try {
      await api.delete(`/notifications/${notificationId}`);
      // Supprimer la notification de la liste
      const notification = notifications.find(n => n.id === notificationId);
      setNotifications(notifications.filter(n => n.id !== notificationId));
      // Mettre à jour le compteur si la notification n'était pas lue
      if (notification && !notification.read) {
        setUnreadCount(Math.max(0, unreadCount - 1));
      }
    } catch (error) {
      console.error('Erreur suppression notification:', error);
      alert('Erreur lors de la suppression de la notification');
    }
  };

  const handleNotificationClick = (notification) => {
    markNotificationAsRead(notification.id);
    setShowNotifications(false);
    // Rediriger vers le devis avec le commentaire
    setQuoteToOpen({ quoteId: notification.quote_id, commentId: notification.comment_id });
    setCurrentPage('quotes');
  };

  const handleLogout = () => {
    setUser(null);
    setCurrentPage('login');
  };

  // Vérifier les permissions selon le rôle
  useEffect(() => {
    if (!user) return;

    const roleLower = (user.role || '').toLowerCase();
    const hasAccess = {
      'admin': ['dashboard', 'clients', 'products', 'quotes', 'profile', 'users', 'config'],
      'commercial': ['dashboard', 'clients', 'products', 'quotes', 'profile'],
      'lecteur': ['dashboard', 'quotes', 'profile']
    };

    const allowedPages = hasAccess[roleLower] || hasAccess.lecteur;
    
    if (!allowedPages.includes(currentPage)) {
      setCurrentPage('dashboard');
    }
  }, [user, currentPage]);

  // Charger les notifications périodiquement
  useEffect(() => {
    if (!user?.id) return;
    
    // Charger immédiatement
    loadNotifications(user.id);
    loadUnreadCount(user.id);
    
    // Recharger toutes les 30 secondes
    const interval = setInterval(() => {
      loadNotifications(user.id);
      loadUnreadCount(user.id);
    }, 30000);
    
    return () => clearInterval(interval);
  }, [user]);

  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div className={darkMode ? 'dark' : ''}>
      <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
        {/* Sidebar */}
        <aside className="w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
          <div className="p-6 border-b border-gray-200 dark:border-gray-700">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">
              Gestion Commerciale
            </h1>
          </div>

          <nav className="flex-1 p-4 space-y-2">
            <NavButton
              active={currentPage === 'dashboard'}
              onClick={() => setCurrentPage('dashboard')}
              icon="📊"
            >
              Dashboard
            </NavButton>
            {user?.role && (user.role.toLowerCase() === 'admin' || user.role.toLowerCase() === 'commercial') && (
              <>
            <NavButton
              active={currentPage === 'clients'}
              onClick={() => setCurrentPage('clients')}
              icon="👥"
            >
              Clients
            </NavButton>
            <NavButton
              active={currentPage === 'products'}
              onClick={() => setCurrentPage('products')}
              icon="📦"
            >
              Produits
            </NavButton>
              </>
            )}
            <NavButton
              active={currentPage === 'quotes'}
              onClick={() => setCurrentPage('quotes')}
              icon="📄"
            >
              Devis
            </NavButton>
            <NavButton
              active={currentPage === 'profile'}
              onClick={() => setCurrentPage('profile')}
              icon="👤"
            >
              Mon profil
            </NavButton>
            {user?.role && user.role.toLowerCase() === 'admin' && (
              <>
                <NavButton
                  active={currentPage === 'users'}
                  onClick={() => setCurrentPage('users')}
                  icon="👤"
                >
                  Utilisateurs
            </NavButton>
            <NavButton
              active={currentPage === 'config'}
              onClick={() => setCurrentPage('config')}
              icon="⚙️"
            >
              Configuration
            </NavButton>
              </>
            )}
          </nav>

          <div className="p-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
            {/* Notifications */}
            <div className="relative mb-3">
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className="w-full px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 flex items-center justify-between relative"
              >
                <span className="flex items-center gap-2">
                  <span>🔔</span>
                  Notifications
                </span>
                {unreadCount > 0 && (
                  <span className="bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
              
              {/* Dropdown Notifications */}
              {showNotifications && (
                <>
                  <div 
                    className="fixed inset-0 z-40" 
                    onClick={() => setShowNotifications(false)}
                  />
                  <div className="absolute bottom-full left-0 right-0 mb-2 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 max-h-96 overflow-y-auto z-50">
                    <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                      <h3 className="font-semibold text-gray-900 dark:text-white">Notifications</h3>
                    </div>
                    {notifications.length === 0 ? (
                      <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
                        Aucune notification
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-200 dark:divide-gray-700">
                        {notifications.map((notif) => (
                          <div
                            key={notif.id}
                            className={`relative w-full p-4 hover:bg-gray-50 dark:hover:bg-gray-700 ${
                              !notif.read ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                            }`}
                          >
                            <button
                              onClick={() => handleNotificationClick(notif)}
                              className="w-full text-left pr-8"
                            >
                              <p className={`text-sm ${!notif.read ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'}`}>
                                {notif.message}
                              </p>
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                {notif.created_at ? new Date(notif.created_at).toLocaleString('fr-FR') : '-'}
                              </p>
                            </button>
                            <button
                              onClick={(e) => handleDeleteNotification(notif.id, e)}
                              className="absolute top-2 right-2 p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400 rounded"
                              title="Supprimer"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center mb-3">
              <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                <span className="text-xl">👤</span>
              </div>
              <div className="ml-3">
                <p className="font-semibold text-sm text-gray-800 dark:text-gray-200">
                  {user?.name || 'Administrateur'}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {user?.email || 'admin@demo.com'}
                </p>
                {user?.role && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    {user.role.toLowerCase() === 'admin' ? '👑 Administrateur' : user.role.toLowerCase() === 'commercial' ? '💼 Commercial' : '👁️ Lecteur'}
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="w-full px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
            >
              {darkMode ? '☀️ Mode clair' : '🌙 Mode sombre'}
            </button>
            <button
              onClick={handleLogout}
              className="w-full px-4 py-2 text-sm rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/40"
            >
              🚪 Déconnexion
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          {currentPage === 'dashboard' && <Dashboard onNavigate={setCurrentPage} />}
          {user?.role && (user.role.toLowerCase() === 'admin' || user.role.toLowerCase() === 'commercial') && currentPage === 'clients' && <ClientsPage />}
          {user?.role && (user.role.toLowerCase() === 'admin' || user.role.toLowerCase() === 'commercial') && currentPage === 'products' && <ProductsPage />}
          {currentPage === 'quotes' && <QuotesPage user={user} quoteToOpen={quoteToOpen} onQuoteOpened={() => setQuoteToOpen(null)} />}
          {currentPage === 'profile' && <ProfilePage user={user} onUpdateUser={setUser} />}
          {user?.role && user.role.toLowerCase() === 'admin' && currentPage === 'users' && <UsersPage />}
          {user?.role && user.role.toLowerCase() === 'admin' && currentPage === 'config' && <ConfigPage />}
        </main>
      </div>
    </div>
  );
}

// Bouton de navigation
function NavButton({ active, onClick, icon, children }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center px-4 py-2.5 rounded-lg text-left ${
        active
          ? 'bg-blue-600 text-white font-semibold'
          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
      }`}
    >
      <span className="mr-3">{icon}</span>
      {children}
    </button>
  );
}

// Page de connexion
function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('admin@demo.com');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await api.post('/auth/login', { email, password });
      onLogin(response.user);
    } catch (err) {
      setError('Erreur de connexion. Vérifiez vos identifiants.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white p-8 rounded-xl shadow-lg">
        <div className="text-center mb-8">
          <img
            src="https://images.seeklogo.com/logo-png/35/2/monetique-tunisie-logo-png_seeklogo-354354.png"
            alt="Logo"
            className="mx-auto mb-4 h-16 w-auto object-contain"
          />
          <h1 className="text-xl font-semibold text-gray-700 mb-1">Gestion Commerciale</h1>
          <p className="text-gray-500 mt-2">Connectez-vous à votre compte</p>
        </div>

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Adresse e-mail
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="vous@exemple.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Mot de passe
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Entrez votre mot de passe"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              {error}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {loading ? 'Connexion...' : 'Se Connecter'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Dashboard
function Dashboard({ onNavigate }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activityData, setActivityData] = useState(null);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    loadStats();
    loadActivity();
  }, []);

  const loadStats = async () => {
    try {
      const data = await api.get('/stats/dashboard?t=' + Date.now());
      setStats(data);
    } catch (error) {
      console.error('Erreur chargement stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadActivity = async () => {
    try {
      setLoadingActivity(true);
      const params = new URLSearchParams();
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);
      
      const queryString = params.toString();
      const url = `/stats/activity${queryString ? '?' + queryString : ''}`;
      const data = await api.get(url);
      setActivityData(data);
    } catch (error) {
      console.error('Erreur chargement activité:', error);
    } finally {
      setLoadingActivity(false);
    }
  };

  const handleFilterActivity = (e) => {
    e.preventDefault();
    loadActivity();
  };

  const handleResetDates = () => {
    setStartDate('');
    setEndDate('');
    // Recharger avec des dates vides
    const loadActivityWithoutDates = async () => {
      try {
        setLoadingActivity(true);
        const data = await api.get('/stats/activity');
        setActivityData(data);
      } catch (error) {
        console.error('Erreur chargement activité:', error);
      } finally {
        setLoadingActivity(false);
      }
    };
    loadActivityWithoutDates();
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-4xl mb-4">⏳</div>
          <p className="text-gray-500">Chargement des statistiques...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <header className="mb-8">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white">Dashboard</h2>
        <p className="text-gray-500 dark:text-gray-400">Vue d'ensemble de votre activité commerciale</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Clients"
          value={stats?.clients || 0}
          subtitle="Clients enregistrés"
          icon="👥"
          color="blue"
          onClick={onNavigate ? () => onNavigate('clients') : undefined}
        />
        <StatCard
          title="Produits"
          value={stats?.products || 0}
          subtitle="Produits au catalogue"
          icon="📦"
          color="green"
          onClick={onNavigate ? () => onNavigate('products') : undefined}
        />
        <StatCard
          title="Devis"
          value={stats?.quotes_pending || 0}
          subtitle="En attente"
          icon="📄"
          color="yellow"
          onClick={onNavigate ? () => onNavigate('quotes') : undefined}
        />
        {/* CA du mois : uniquement devis acceptés, par devise, sans conversion */}
        {Array.isArray(stats?.revenue_by_currency) && stats.revenue_by_currency.length > 0 ? (
          stats.revenue_by_currency.map((rev, index) => (
            <StatCard
              key={rev.currency_code || `currency-${index}`}
              title={`CA HT du mois (${rev.currency_code || 'N/A'})`}
              value={`${(rev.total || 0).toFixed(2)} ${(rev.currency_symbol ?? '').trim()}`.trim()}
              subtitle="Devis acceptés (HT)"
              icon="📈"
              color="purple"
            />
          ))
        ) : (
          <StatCard
            title="CA HT du mois"
            value="—"
            subtitle="Aucune devise configurée (Configuration > Devises)"
            icon="📈"
            color="purple"
          />
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
        <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
          Activité récente (30 derniers jours)
        </h3>
        {stats?.quotes_by_status && stats.quotes_by_status.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left py-3 px-4 font-semibold text-gray-700 dark:text-gray-300">Statut</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700 dark:text-gray-300">Devise</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-700 dark:text-gray-300">Nombre de devis</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-700 dark:text-gray-300">Montant total (HT)</th>
                </tr>
              </thead>
              <tbody>
                {stats.quotes_by_status.map((item, index) => {
                  const statusLabels = {
                    'pending': 'En attente',
                    'created': 'Créé',
                    'sent': 'Envoyé',
                    'accepted': 'Accepté',
                    'rejected': 'Refusé',
                    'confirmed': 'Confirmé'
                  };
                  const statusColors = {
                    'pending': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200',
                    'created': 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
                    'sent': 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200',
                    'accepted': 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
                    'rejected': 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
                    'confirmed': 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200'
                  };
                  return (
                    <tr key={index} className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="py-3 px-4">
                        <span className={`inline-flex px-2 py-1 rounded-full text-xs font-semibold ${statusColors[item.status] || 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'}`}>
                          {statusLabels[item.status] || item.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-gray-900 dark:text-white font-medium">
                        {item.currency_code || 'N/A'} {item.currency_symbol || ''}
                      </td>
                      <td className="text-right py-3 px-4 text-gray-900 dark:text-white font-medium">
                        {item.count}
                      </td>
                      <td className="text-right py-3 px-4 text-gray-900 dark:text-white font-medium">
                        {item.total_amount.toFixed(2)} {item.currency_symbol || ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 dark:border-gray-600 font-semibold">
                  <td className="py-3 px-4 text-gray-900 dark:text-white">Total</td>
                  <td className="text-right py-3 px-4 text-gray-900 dark:text-white">
                    {stats.quotes_by_status.reduce((sum, item) => sum + item.count, 0)}
                  </td>
                  <td className="text-right py-3 px-4 text-gray-900 dark:text-white">
                    {stats.quotes_by_status
                      .reduce((sum, item) => sum + item.total_amount, 0)
                      .toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
        <div className="text-center py-12">
          <div className="text-6xl mb-4">📊</div>
          <p className="text-gray-500 dark:text-gray-400">
            Aucune activité récente pour le moment
          </p>
        </div>
        )}
      </div>

      {/* Encart Activité avec filtres de date */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow mt-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
          Activité
        </h3>
        
        {/* Filtres de date */}
        <form onSubmit={handleFilterActivity} className="mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Date de début
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Date de fin
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div className="flex items-end gap-2">
              <button
                type="submit"
                disabled={loadingActivity}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50"
              >
                {loadingActivity ? 'Chargement...' : 'Filtrer'}
              </button>
              <button
                type="button"
                onClick={handleResetDates}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Réinitialiser
              </button>
            </div>
          </div>
        </form>

        {/* Résultats */}
        {loadingActivity ? (
          <div className="text-center py-8">
            <p className="text-gray-500 dark:text-gray-400">Chargement...</p>
          </div>
        ) : activityData?.quotes_by_status && activityData.quotes_by_status.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left py-3 px-4 font-semibold text-gray-700 dark:text-gray-300">Statut</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700 dark:text-gray-300">Devise</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-700 dark:text-gray-300">Nombre de devis</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-700 dark:text-gray-300">Montant total (HT)</th>
                </tr>
              </thead>
              <tbody>
                {activityData.quotes_by_status.map((item, index) => {
                  const statusLabels = {
                    'pending': 'En attente',
                    'created': 'Créé',
                    'sent': 'Envoyé',
                    'accepted': 'Accepté',
                    'rejected': 'Refusé',
                    'confirmed': 'Confirmé'
                  };
                  const statusColors = {
                    'pending': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200',
                    'created': 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
                    'sent': 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200',
                    'accepted': 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
                    'rejected': 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
                    'confirmed': 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200'
                  };
                  return (
                    <tr key={index} className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="py-3 px-4">
                        <span className={`inline-flex px-2 py-1 rounded-full text-xs font-semibold ${statusColors[item.status] || 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'}`}>
                          {statusLabels[item.status] || item.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-gray-900 dark:text-white font-medium">
                        {item.currency_code || 'N/A'} {item.currency_symbol || ''}
                      </td>
                      <td className="text-right py-3 px-4 text-gray-900 dark:text-white font-medium">
                        {item.count}
                      </td>
                      <td className="text-right py-3 px-4 text-gray-900 dark:text-white font-medium">
                        {item.total_amount.toFixed(2)} {item.currency_symbol || ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 dark:border-gray-600 font-semibold">
                  <td className="py-3 px-4 text-gray-900 dark:text-white">Total</td>
                  <td className="text-right py-3 px-4 text-gray-900 dark:text-white">
                    {activityData.quotes_by_status.reduce((sum, item) => sum + item.count, 0)}
                  </td>
                  <td className="text-right py-3 px-4 text-gray-900 dark:text-white">
                    {activityData.quotes_by_status
                      .reduce((sum, item) => sum + item.total_amount, 0)
                      .toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">📊</div>
            <p className="text-gray-500 dark:text-gray-400">
              Aucune activité pour la période sélectionnée
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ title, value, subtitle, icon, color, onClick }) {
  const colors = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    green: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
    yellow: 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400',
    purple: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400'
  };

  const baseClass = 'bg-white dark:bg-gray-800 p-6 rounded-lg shadow border border-gray-200 dark:border-gray-700';
  const clickableClass = onClick
    ? `${baseClass} cursor-pointer hover:ring-2 hover:ring-blue-500 dark:hover:ring-blue-400 hover:border-blue-400 dark:hover:border-blue-500 transition-all select-none`
    : baseClass;

  const content = (
    <>
      <div className="flex justify-between items-start mb-4">
        <h3 className="font-semibold text-gray-600 dark:text-gray-400">{title}</h3>
        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${colors[color]}`}>
          <span className="text-xl">{icon}</span>
        </div>
      </div>
      <p className="text-3xl font-bold text-gray-900 dark:text-white mb-1">{value}</p>
      <p className="text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
      {onClick && (
        <p className="text-xs text-blue-600 dark:text-blue-400 mt-2 font-medium flex items-center gap-1">
          <span>Cliquer pour accéder</span>
          <span aria-hidden>→</span>
        </p>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`w-full text-left block ${clickableClass}`}
      >
        {content}
      </button>
    );
  }

  return <div className={clickableClass}>{content}</div>;
}

// Page Mon Profil
function ProfilePage({ user, onUpdateUser }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    signature_text: '',
    signature_link: ''
  });
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [signaturePreviewUrl, setSignaturePreviewUrl] = useState(null);
  const [uploadingSignature, setUploadingSignature] = useState(false);
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [signatureType, setSignatureType] = useState('file'); // 'file' ou 'link'

  useEffect(() => {
    if (user?.id) {
      loadProfile();
    }
  }, [user]);

  const loadProfile = async () => {
    try {
      setLoading(true);
      const data = await api.get(`/auth/profile?userId=${user.id}`);
      setProfile(data);
      setFormData({
        name: data.name || '',
        email: data.email || '',
        password: '',
        confirmPassword: '',
        signature_text: data.signature_text || '',
        signature_link: data.signature_link || ''
      });

      if (data.signature_file_path) {
        setSignaturePreviewUrl(getUploadsDisplayUrl(data.signature_file_path, data.updated_at));
      } else {
        setSignaturePreviewUrl(null);
      }

      if (data.signature_link) {
        setSignatureType('link');
      } else if (data.signature_file_path) {
        setSignatureType('file');
      } else {
        setSignatureType('file');
      }
    } catch (error) {
      console.error('Erreur chargement profil:', error);
      setError('Erreur lors du chargement du profil');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    // Vérifier que les mots de passe correspondent si un nouveau mot de passe est fourni
    if (formData.password && formData.password !== formData.confirmPassword) {
      setError('Les mots de passe ne correspondent pas');
      return;
    }

    try {
      setSaving(true);
      const updateData = {
        userId: user.id,
        name: formData.name,
        email: formData.email,
        signature_text: formData.signature_text,
        signature_link: formData.signature_link
      };
      
      // Ajouter le mot de passe seulement s'il est fourni
      if (formData.password) {
        updateData.password = formData.password;
      }

      const updatedProfile = await api.put('/auth/profile', updateData);
      setProfile(updatedProfile);
      
      // Mettre à jour l'utilisateur dans le contexte
      onUpdateUser({
        ...user,
        name: updatedProfile.name,
        email: updatedProfile.email,
        role: updatedProfile.role
      });
      
      setMessage('Profil mis à jour avec succès');
      
      // Réinitialiser les champs de mot de passe
      setFormData({
        ...formData,
        password: '',
        confirmPassword: ''
      });
      
      // Effacer le message après 3 secondes
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      console.error('Erreur mise à jour profil:', error);
      setError(error.message || 'Erreur lors de la mise à jour du profil');
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getRoleLabel = (role) => {
    const labels = {
      'admin': 'Administrateur',
      'commercial': 'Commercial',
      'lecteur': 'Lecteur'
    };
    return labels[role] || role;
  };

  const handleSignatureUpload = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    setUploadingSignature(true);
    setError(null);
    setMessage(null);

    try {
      const form = new FormData();
      form.append('userId', user.id);
      form.append('file', file);
      form.append('signature_text', formData.signature_text || '');

      const response = await fetch(`${API_URL}/auth/profile/signature`, {
        method: 'POST',
        body: form
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de l\'upload de la signature');
      }

      setProfile(data);
      setFormData((prev) => ({
        ...prev,
        signature_text: data.signature_text || ''
      }));

      if (data.signature_file_path) {
        setSignaturePreviewUrl(getUploadsDisplayUrl(data.signature_file_path, data.updated_at));
      }

      setMessage('Signature mise à jour avec succès');
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      console.error('Erreur upload signature:', err);
      setError(err.message || 'Erreur lors de l\'upload de la signature');
    } finally {
      setUploadingSignature(false);
    }
  };

  const handleClearSignatureFile = async () => {
    setUploadingSignature(true);
    setError(null);
    setMessage(null);

    try {
      const form = new FormData();
      form.append('userId', user.id);
      form.append('signature_text', formData.signature_text || '');
      form.append('signature_link', formData.signature_link || '');
      form.append('clear_file', 'true');

      const response = await fetch(`${API_URL}/auth/profile/signature`, {
        method: 'POST',
        body: form
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de la suppression de la signature');
      }

      setProfile(data);
      setSignaturePreviewUrl(null);
      setMessage('Image de signature supprimée avec succès');
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      console.error('Erreur suppression signature:', err);
      setError(err.message || 'Erreur lors de la suppression de la signature');
    } finally {
      setUploadingSignature(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-4xl mb-4">⏳</div>
          <p className="text-gray-500">Chargement du profil...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <header className="mb-8">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white">Mon Profil</h2>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Gérez vos informations personnelles</p>
      </header>

      {/* Messages */}
      {message && (
        <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-green-800 dark:text-green-200">
          {message}
        </div>
      )}

      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Informations générales */}
        <div className="lg:col-span-2">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">
              Informations personnelles
            </h3>
            
            <form onSubmit={handleSubmit}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Nom complet *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="Votre nom"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Email *
                  </label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({...formData, email: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="votre@email.com"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Nouveau mot de passe (laisser vide pour ne pas modifier)
                  </label>
                  <input
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({...formData, password: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="••••••••"
                  />
                </div>

                {formData.password && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Confirmer le nouveau mot de passe *
                    </label>
                    <input
                      type="password"
                      required={!!formData.password}
                      value={formData.confirmPassword}
                      onChange={(e) => setFormData({...formData, confirmPassword: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                      placeholder="••••••••"
                    />
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-4">
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50"
                  >
                    {saving ? 'Enregistrement...' : 'Enregistrer les modifications'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>

        {/* Informations du compte */}
        <div className="lg:col-span-1">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">
              Informations du compte
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Rôle
                </label>
                <p className="text-gray-900 dark:text-white font-medium">
                  {getRoleLabel(profile?.role || user?.role)}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Date de création
                </label>
                <p className="text-gray-900 dark:text-white font-medium">
                  {formatDate(profile?.created_at)}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Dernière modification
                </label>
                <p className="text-gray-900 dark:text-white font-medium">
                  {formatDate(profile?.updated_at)}
                </p>
              </div>

              {/* Signature utilisateur */}
              <div className="pt-4 border-t border-gray-200 dark:border-gray-700 mt-4">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                  Signature pour les emails / documents
                </h4>

                <div className="space-y-3">
                  {/* Choix du type de signature */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Type de signature
                    </label>
                    <div className="flex items-center gap-4 text-sm text-gray-700 dark:text-gray-300">
                      <label className="flex items-center gap-1">
                        <input
                          type="radio"
                          name="signatureType"
                          value="file"
                          checked={signatureType === 'file'}
                          onChange={() => setSignatureType('file')}
                          className="text-blue-600 focus:ring-blue-500"
                        />
                        <span>Fichier (image)</span>
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="radio"
                          name="signatureType"
                          value="link"
                          checked={signatureType === 'link'}
                          onChange={() => setSignatureType('link')}
                          className="text-blue-600 focus:ring-blue-500"
                        />
                        <span>Lien (URL)</span>
                      </label>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Texte de signature
                    </label>
                    <textarea
                      value={formData.signature_text}
                      onChange={(e) => setFormData({ ...formData, signature_text: e.target.value })}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-sm"
                      placeholder="Exemple : Cordialement,&#10;Nom Prénom&#10;Fonction"
                    />
                  </div>

                  {signatureType === 'file' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Fichier de signature (image, max 5 Mo)
                      </label>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleSignatureUpload}
                        disabled={uploadingSignature}
                        className="w-full text-sm text-gray-700 dark:text-gray-300"
                      />
                      {signaturePreviewUrl && (
                        <div className="mt-2 flex items-center gap-3">
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            Une image de signature est actuellement enregistrée.
                          </span>
                          <button
                            type="button"
                            onClick={handleClearSignatureFile}
                            className="text-xs text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                            disabled={uploadingSignature}
                          >
                            Supprimer l&apos;image
                          </button>
                        </div>
                      )}
                      {uploadingSignature && (
                        <p className="text-xs text-blue-500 mt-1">Upload de la signature en cours...</p>
                      )}
                    </div>
                  )}

                  {signatureType === 'link' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Lien de signature (URL)
                      </label>
                      <input
                        type="url"
                        value={formData.signature_link}
                        onChange={(e) => setFormData({ ...formData, signature_link: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-sm"
                        placeholder="https://exemple.com/signature"
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Ce lien sera utilisé à la place d'une image de signature.
                      </p>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setShowSignatureModal(true)}
                    disabled={
                      !formData.signature_text &&
                      ((signatureType === 'file' && !signaturePreviewUrl) ||
                        (signatureType === 'link' && !formData.signature_link))
                    }
                    className="mt-2 px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                  >
                    Visualiser la signature
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Modal aperçu signature */}
        {showSignatureModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Signature de l'utilisateur
                </h3>
                <button
                  onClick={() => setShowSignatureModal(false)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl"
                >
                  ✕
                </button>
              </div>

              {(!formData.signature_text &&
                ((signatureType === 'file' && !signaturePreviewUrl) ||
                  (signatureType === 'link' && !formData.signature_link))) ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Aucune signature définie pour le moment.
                </p>
              ) : (
                <div className="space-y-3">
                  {formData.signature_text && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                        Texte de signature
                      </p>
                      <p className="text-sm text-gray-900 dark:text-white whitespace-pre-line">
                        {formData.signature_text}
                      </p>
                    </div>
                  )}
                  {signatureType === 'link' && formData.signature_link && (
                    <div className="w-full">
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                        Signature (image depuis le lien)
                      </p>
                      <div className="w-full flex justify-center items-center bg-gray-50 dark:bg-gray-700/30 p-4 rounded">
                        <img
                          src={formData.signature_link}
                          alt="Signature"
                          className="max-w-full max-h-96 flex-shrink-0"
                          style={{
                            width: 'auto',
                            height: 'auto',
                            objectFit: 'contain'
                          }}
                        />
                      </div>
                    </div>
                  )}
                  {signatureType === 'file' && signaturePreviewUrl && (
                    <div className="w-full">
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                        Fichier de signature
                      </p>
                      <div className="w-full flex justify-center items-center bg-gray-50 dark:bg-gray-700/30 p-4 rounded">
                        <img
                          src={signaturePreviewUrl}
                          alt="Signature"
                          className="max-w-full max-h-96 flex-shrink-0"
                          style={{
                            width: 'auto',
                            height: 'auto',
                            objectFit: 'contain'
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end mt-6">
                <button
                  type="button"
                  onClick={() => setShowSignatureModal(false)}
                  className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Page de détail Client
function ClientDetailPage({ client, onBack, onUpdate }) {
  const [showEditModal, setShowEditModal] = useState(false);
  const [formData, setFormData] = useState({
    name: client.name || '',
    email: client.email || '',
    phone: client.phone || '',
    matricule_fiscal: client.matricule_fiscal || '',
    address: client.address || '',
    city: client.city || '',
    postal_code: client.postal_code || '',
    country: client.country || 'France',
    logo_url: client.logo_url || '',
    contacts: client.contacts && Array.isArray(client.contacts) ? client.contacts.map(c => ({
      name: c.name || '',
      position: c.position || '',
      email: c.email || '',
      phone: c.phone || ''
    })) : []
  });

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const contacts = client.contacts && Array.isArray(client.contacts) ? client.contacts : [];
  const quotes = client.quotes || [];
  const [logoType, setLogoType] = useState(client.logo_url ? 'link' : (client.logo_file_path ? 'file' : 'file'));

  const getClientLogoUrl = () => {
    if (logoType === 'link' && formData.logo_url) {
      return formData.logo_url;
    }
    if (logoType === 'file' && client.logo_file_path) {
      const baseUrl = API_URL.replace('/api', '');
      const relativePath = client.logo_file_path.replace(/^uploads[\\/]/, '');
      return `${baseUrl}/uploads/${relativePath}`;
    }
    return null;
  };

  const [logoPreviewUrl, setLogoPreviewUrl] = useState(getClientLogoUrl());
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const handleLogoUpload = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    setUploadingLogo(true);
    try {
      const form = new FormData();
      form.append('file', file);

      const response = await fetch(`${API_URL}/clients/${client.id}/logo`, {
        method: 'POST',
        body: form
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de l\'upload du logo');
      }

      if (onUpdate) {
        onUpdate(data);
      }

      if (data.logo_file_path) {
        const baseUrl = API_URL.replace('/api', '');
        const relativePath = data.logo_file_path.replace(/^uploads[\\/]/, '');
        setLogoPreviewUrl(`${baseUrl}/uploads/${relativePath}`);
      }
    } catch (error) {
      console.error('Erreur upload logo client:', error);
      alert(error.message || 'Erreur lors de l\'upload du logo');
    } finally {
      setUploadingLogo(false);
    }
  };

  const getStatusLabel = (status) => {
    const labels = {
      pending: 'En attente',
      created: 'Créé',
      sent: 'Envoyé',
      accepted: 'Accepté',
      rejected: 'Refusé',
      confirmed: 'Confirmé'
    };
    return labels[status] || status;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const updatedClient = await api.put(`/clients/${client.id}`, formData);
      setShowEditModal(false);
      if (onUpdate) {
        onUpdate(updatedClient);
      }
    } catch (error) {
      console.error('Erreur modification client:', error);
      alert('Erreur lors de la modification du client');
    }
  };

  const addContact = () => {
    setFormData({
      ...formData,
      contacts: [...formData.contacts, { name: '', position: '', email: '', phone: '' }]
    });
  };

  const removeContact = (index) => {
    setFormData({
      ...formData,
      contacts: formData.contacts.filter((_, i) => i !== index)
    });
  };

  const updateContact = (index, field, value) => {
    const newContacts = [...formData.contacts];
    newContacts[index] = { ...newContacts[index], [field]: value };
    setFormData({ ...formData, contacts: newContacts });
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex justify-between items-start mb-8">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          >
            ←
          </button>
          <div>
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white">{client.name}</h2>
            <p className="text-gray-500 dark:text-gray-400 mt-1">Fiche client détaillée</p>
          </div>
        </div>
        <button 
          onClick={() => setShowEditModal(true)}
          className="px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200 font-medium flex items-center gap-2"
        >
          <span>✏️</span>
          Modifier
        </button>
      </div>

      <div className="space-y-6">
        {/* Informations générales */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Informations générales
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Coordonnées, logo et informations de contact
          </p>
          <div className="space-y-4">
            {/* Logo client */}
            {(logoPreviewUrl || client.logo_url) && (
              <div className="flex items-start gap-3">
                <span className="text-gray-500 dark:text-gray-400 mt-1">🏷️</span>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Logo</p>
                  <img
                    src={logoPreviewUrl || client.logo_url}
                    alt={`Logo de ${client.name}`}
                    className="h-16 object-contain border border-gray-200 dark:border-gray-700 bg-white rounded"
                  />
                </div>
              </div>
            )}
            <div className="flex items-start gap-3">
              <span className="text-gray-500 dark:text-gray-400 mt-1">📧</span>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Email</p>
                <p className="text-gray-900 dark:text-white font-medium">{client.email?.toUpperCase() || '-'}</p>
              </div>
            </div>
            {client.phone && (
              <div className="flex items-start gap-3">
                <span className="text-gray-500 dark:text-gray-400 mt-1">📞</span>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Téléphone</p>
                  <p className="text-gray-900 dark:text-white font-medium">{client.phone}</p>
                </div>
              </div>
            )}
            <div className="flex items-start gap-3">
              <span className="text-gray-500 dark:text-gray-400 mt-1">📍</span>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Adresse</p>
                <p className="text-gray-900 dark:text-white font-medium">
                  {client.address || '-'}
                  {client.city && `, ${client.city}`}
                  {client.postal_code && ` ${client.postal_code}`}
                  {client.country && `, ${client.country}`}
                </p>
              </div>
            </div>
            {client.matricule_fiscal && (
              <div className="flex items-start gap-3">
                <span className="text-gray-500 dark:text-gray-400 mt-1">🏢</span>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Matricule Fiscal</p>
                  <p className="text-gray-900 dark:text-white font-medium">{client.matricule_fiscal}</p>
                </div>
              </div>
            )}
            <div className="flex items-start gap-3">
              <span className="text-gray-500 dark:text-gray-400 mt-1">📅</span>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Date de création</p>
                <p className="text-gray-900 dark:text-white font-medium">{formatDate(client.created_at)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Contacts */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Contacts</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Personnes de contact chez le client
          </p>
          {contacts.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400">Aucun contact enregistré</p>
          ) : (
            <div className="space-y-4">
              {contacts.map((contact, index) => (
                <div key={index} className="border-l-4 border-blue-500 pl-4 py-2">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-gray-500 dark:text-gray-400">👤</span>
                    <p className="text-gray-900 dark:text-white font-medium">{contact.name}</p>
                  </div>
                  {contact.position && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">{contact.position}</p>
                  )}
                  <div className="flex flex-wrap gap-4 mt-2">
                    {contact.email && (
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500 dark:text-gray-400">📧</span>
                        <p className="text-sm text-gray-600 dark:text-gray-400">{contact.email}</p>
                      </div>
                    )}
                    {contact.phone && (
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500 dark:text-gray-400">📞</span>
                        <p className="text-sm text-gray-600 dark:text-gray-400">{contact.phone}</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Devis associés */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Devis associés</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Liste des devis créés pour ce client
          </p>
          {quotes.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400">Aucun devis pour ce client</p>
          ) : (
            <div className="space-y-2">
              {quotes.map((quote) => (
                <div
                  key={quote.id}
                  className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
                >
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {quote.quote_number || `Devis #${quote.id}`}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {formatDate(quote.date)}{' '}
                      {quote.total_ht
                        ? `- ${Number(quote.total_ht).toFixed(2)}${quote.currency_symbol || ''}`
                        : ''}
                    </p>
                  </div>
                  <span
                    className={`px-2 py-1 rounded-full text-xs font-semibold ${
                    quote.status === 'confirmed' 
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200'
                      : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200'
                    }`}
                  >
                    {getStatusLabel(quote.status || 'pending')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Historique des modifications */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Historique des modifications
          </h3>
          <p className="text-gray-500 dark:text-gray-400">Aucune modification enregistrée</p>
        </div>
      </div>

      {/* Modal Modification Client */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">Modifier le client</h3>
              <button
                onClick={() => setShowEditModal(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-2 gap-6">
                {/* Colonne gauche */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Nom *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({...formData, name: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                      placeholder="Nom de la société"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Téléphone
                    </label>
                    <input
                      type="tel"
                      value={formData.phone || ''}
                      onChange={(e) => setFormData({...formData, phone: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Adresse *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.address}
                      onChange={(e) => setFormData({...formData, address: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Ville *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.city}
                      onChange={(e) => setFormData({...formData, city: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Contacts
                    </label>
                    <button
                      type="button"
                      onClick={addContact}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 flex items-center justify-center gap-2"
                    >
                      <span>+</span>
                      Ajouter un contact
                    </button>
                  </div>

                  {/* Logo - URL */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      URL du logo (optionnel)
                    </label>
                    <input
                      type="url"
                      value={formData.logo_url}
                      onChange={(e) => {
                        setLogoType('link');
                        setFormData({ ...formData, logo_url: e.target.value });
                        setLogoPreviewUrl(e.target.value || getClientLogoUrl());
                      }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                      placeholder="https://exemple.com/logo.png"
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Si une URL est fournie, elle sera utilisée comme logo. Vous pouvez aussi téléverser un fichier ci-contre.
                    </p>
                    <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
                      Pour que le logo apparaisse dans le PDF, il est recommandé de téléverser un fichier plutôt que d&apos;utiliser une URL externe.
                    </p>
                  </div>
                </div>

                {/* Colonne droite */}
                <div className="space-y-4">
                  {/* Logo - fichier */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Fichier logo (image, max 5 Mo)
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleLogoUpload}
                      disabled={uploadingLogo}
                      className="w-full text-sm text-gray-700 dark:text-gray-300"
                    />
                    {uploadingLogo && (
                      <p className="text-xs text-blue-500 mt-1">Upload du logo en cours...</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Email *
                    </label>
                    <input
                      type="email"
                      required
                      value={formData.email}
                      onChange={(e) => setFormData({...formData, email: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                      placeholder="Email de la société"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Matricule Fiscal
                    </label>
                    <input
                      type="text"
                      value={formData.matricule_fiscal}
                      onChange={(e) => setFormData({...formData, matricule_fiscal: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Code postal *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.postal_code}
                      onChange={(e) => setFormData({...formData, postal_code: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Pays *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.country}
                      onChange={(e) => setFormData({...formData, country: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                </div>
              </div>

              {/* Liste des contacts */}
              {formData.contacts.length > 0 && (
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                  <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Contacts</h4>
                  <div className="space-y-4">
                    {formData.contacts.map((contact, index) => (
                      <div key={index} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
                        <div className="flex justify-between items-center mb-3">
                          <span className="font-medium text-gray-900 dark:text-white">Contact {index + 1}</span>
                          <button
                            type="button"
                            onClick={() => removeContact(index)}
                            className="text-red-600 hover:text-red-800 dark:text-red-400"
                          >
                            🗑️
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                              Nom
                            </label>
                            <input
                              type="text"
                              value={contact.name}
                              onChange={(e) => updateContact(index, 'name', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                              Poste
                            </label>
                            <input
                              type="text"
                              value={contact.position}
                              onChange={(e) => updateContact(index, 'position', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                              Email
                            </label>
                            <input
                              type="email"
                              value={contact.email}
                              onChange={(e) => updateContact(index, 'email', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                              Téléphone
                            </label>
                            <input
                              type="tel"
                              value={contact.phone}
                              onChange={(e) => updateContact(index, 'phone', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-6 py-2 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200 font-medium"
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Page Clients
// Composant de pagination réutilisable
function Pagination({ currentPage, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;

  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    pages.push(i);
  }

  // Afficher seulement les pages proches de la page actuelle
  const getVisiblePages = () => {
    if (totalPages <= 7) return pages;
    if (currentPage <= 4) return [1, 2, 3, 4, 5, '...', totalPages];
    if (currentPage >= totalPages - 3) return [1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    return [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages];
  };

  const visiblePages = getVisiblePages();

  return (
    <div className="flex items-center justify-between border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
      <div className="flex-1 flex justify-between sm:hidden">
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="relative inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 text-sm font-medium rounded-md text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Précédent
        </button>
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 text-sm font-medium rounded-md text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Suivant
        </button>
      </div>
      <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Page <span className="font-medium">{currentPage}</span> sur <span className="font-medium">{totalPages}</span>
          </p>
        </div>
        <div>
          <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
            <button
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Précédent
            </button>
            {visiblePages.map((page, index) => (
              page === '...' ? (
                <span key={`ellipsis-${index}`} className="relative inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-medium text-gray-700 dark:text-gray-300">
                  ...
                </span>
              ) : (
                <button
                  key={page}
                  onClick={() => onPageChange(page)}
                  className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
                    currentPage === page
                      ? 'z-10 bg-blue-50 dark:bg-blue-900/20 border-blue-500 dark:border-blue-400 text-blue-600 dark:text-blue-400'
                      : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  {page}
                </button>
              )
            ))}
            <button
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Suivant
            </button>
          </nav>
        </div>
      </div>
    </div>
  );
}

function ClientsPage() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCity, setFilterCity] = useState('');
  const [filterCountry, setFilterCountry] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    matricule_fiscal: '',
    address: '',
    city: '',
    postal_code: '',
    country: 'France',
    contacts: []
  });

  useEffect(() => {
    loadClients();
  }, []);

  const loadClients = async () => {
    try {
      const data = await api.get('/clients');
      setClients(data);
    } catch (error) {
      console.error('Erreur chargement clients:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Confirmer la suppression de ce client ?')) return;
    
    try {
      await api.delete(`/clients/${id}`);
      loadClients();
      // Réinitialiser à la première page si on supprime le dernier élément de la dernière page
      const maxPage = Math.ceil((filteredClients.length - 1) / itemsPerPage);
      if (currentPage > maxPage && maxPage > 0) {
        setCurrentPage(maxPage);
      }
    } catch (error) {
      console.error('Erreur suppression:', error);
      alert('Erreur lors de la suppression');
    }
  };

  const handleViewClient = async (id) => {
    try {
      const client = await api.get(`/clients/${id}`);
      // Récupérer les devis du client
      const quotes = await api.get('/quotes');
      const clientQuotes = quotes.filter(q => q.client_id === id);
      setSelectedClient({ ...client, quotes: clientQuotes });
    } catch (error) {
      console.error('Erreur chargement client:', error);
      alert('Erreur lors du chargement des détails du client');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/clients', formData);
      setShowModal(false);
      setFormData({
        name: '',
        email: '',
        phone: '',
        matricule_fiscal: '',
        address: '',
        city: '',
        postal_code: '',
        country: 'France',
        contacts: []
      });
      loadClients();
      setCurrentPage(1); // Réinitialiser à la première page après création
    } catch (error) {
      console.error('Erreur création client:', error);
      alert('Erreur lors de la création du client');
    }
  };

  const addContact = () => {
    setFormData({
      ...formData,
      contacts: [...formData.contacts, { name: '', position: '', email: '', phone: '' }]
    });
  };

  const removeContact = (index) => {
    setFormData({
      ...formData,
      contacts: formData.contacts.filter((_, i) => i !== index)
    });
  };

  const updateContact = (index, field, value) => {
    const newContacts = [...formData.contacts];
    newContacts[index] = { ...newContacts[index], [field]: value };
    setFormData({ ...formData, contacts: newContacts });
  };

  // Filtrer les clients
  const filteredClients = clients.filter(client => {
    // Recherche textuelle
    const matchesSearch = searchQuery === '' || 
      client.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      client.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      client.phone?.toLowerCase().includes(searchQuery.toLowerCase());
    
    // Filtre par ville
    const matchesCity = filterCity === '' || 
      client.city?.toLowerCase() === filterCity.toLowerCase();
    
    // Filtre par pays
    const matchesCountry = filterCountry === '' || 
      client.country?.toLowerCase() === filterCountry.toLowerCase();
    
    return matchesSearch && matchesCity && matchesCountry;
  });

  // Réinitialiser les filtres
  const handleResetFilters = () => {
    setSearchQuery('');
    setFilterCity('');
    setFilterCountry('');
    setCurrentPage(1);
  };

  // Obtenir les villes uniques pour le filtre
  const uniqueCities = [...new Set(clients.map(c => c.city).filter(Boolean))].sort();
  
  // Obtenir les pays uniques pour le filtre
  const uniqueCountries = [...new Set(clients.map(c => c.country).filter(Boolean))].sort();

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-4xl mb-4">⏳</div>
          <p className="text-gray-500">Chargement des clients...</p>
        </div>
      </div>
    );
  }

  // Afficher la page de détail si un client est sélectionné
  if (selectedClient) {
    return (
      <ClientDetailPage 
        client={selectedClient} 
        onBack={() => setSelectedClient(null)}
        onUpdate={async (updatedClient) => {
          // Recharger les devis pour ce client
          try {
            const quotes = await api.get('/quotes');
            const clientQuotes = quotes.filter(q => q.client_id === updatedClient.id);
            setSelectedClient({ ...updatedClient, quotes: clientQuotes });
          } catch (error) {
            console.error('Erreur chargement devis:', error);
            setSelectedClient(updatedClient);
          }
          loadClients(); // Recharger la liste pour mettre à jour les données
        }}
      />
    );
  }

  return (
    <div className="p-8">
      <header className="mb-8 flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white">Clients</h2>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Gérez vos clients et leurs contacts</p>
        </div>
        <button 
          onClick={() => setShowModal(true)}
          className="px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium flex items-center gap-2"
        >
          <span>➕</span>
          Nouveau client
        </button>
      </header>

      {/* Barre de recherche et filtres */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Recherche */}
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              🔍 Recherche
            </label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1); // Réinitialiser à la première page lors de la recherche
              }}
              placeholder="Rechercher par nom, email ou téléphone..."
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            />
          </div>

          {/* Filtre par ville */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              🏙️ Ville
            </label>
            <select
              value={filterCity}
              onChange={(e) => {
                setFilterCity(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            >
              <option value="">Toutes les villes</option>
              {uniqueCities.map(city => (
                <option key={city} value={city}>{city}</option>
              ))}
            </select>
          </div>

          {/* Filtre par pays */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              🌍 Pays
            </label>
            <select
              value={filterCountry}
              onChange={(e) => {
                setFilterCountry(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            >
              <option value="">Tous les pays</option>
              {uniqueCountries.map(country => (
                <option key={country} value={country}>{country}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Bouton réinitialiser les filtres */}
        {(searchQuery || filterCity || filterCountry) && (
          <div className="mt-4 flex justify-end">
            <button
              onClick={handleResetFilters}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
            >
              <span>↻</span>
              Réinitialiser les filtres
            </button>
          </div>
        )}

        {/* Affichage du nombre de résultats */}
        <div className="mt-4 text-sm text-gray-500 dark:text-gray-400">
          {filteredClients.length === clients.length ? (
            <span>{clients.length} client{clients.length > 1 ? 's' : ''} au total</span>
          ) : (
            <span>
              {filteredClients.length} client{filteredClients.length > 1 ? 's' : ''} trouvé{filteredClients.length > 1 ? 's' : ''} 
              {' '}sur {clients.length} au total
            </span>
          )}
        </div>
      </div>

      {/* Modal Nouveau Client */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">Nouveau client</h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-2 gap-6">
                {/* Colonne gauche */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Nom *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({...formData, name: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                      placeholder="Nom de la société"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Téléphone
                    </label>
                    <input
                      type="tel"
                      value={formData.phone || ''}
                      onChange={(e) => setFormData({...formData, phone: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Adresse *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.address}
                      onChange={(e) => setFormData({...formData, address: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Ville *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.city}
                      onChange={(e) => setFormData({...formData, city: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Contacts
                    </label>
                    <button
                      type="button"
                      onClick={addContact}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 flex items-center justify-center gap-2"
                    >
                      <span>+</span>
                      Ajouter un contact
                    </button>
                  </div>
                </div>

                {/* Colonne droite */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Email *
                    </label>
                    <input
                      type="email"
                      required
                      value={formData.email}
                      onChange={(e) => setFormData({...formData, email: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                      placeholder="Email de la société"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Matricule Fiscal
                    </label>
                    <input
                      type="text"
                      value={formData.matricule_fiscal}
                      onChange={(e) => setFormData({...formData, matricule_fiscal: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Code postal *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.postal_code}
                      onChange={(e) => setFormData({...formData, postal_code: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Pays *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.country}
                      onChange={(e) => setFormData({...formData, country: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                </div>
              </div>

              {/* Liste des contacts */}
              {formData.contacts.length > 0 && (
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                  <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Contacts</h4>
                  <div className="space-y-4">
                    {formData.contacts.map((contact, index) => (
                      <div key={index} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
                        <div className="flex justify-between items-center mb-3">
                          <span className="font-medium text-gray-900 dark:text-white">Contact {index + 1}</span>
                          <button
                            type="button"
                            onClick={() => removeContact(index)}
                            className="text-red-600 hover:text-red-800 dark:text-red-400"
                          >
                            🗑️
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                              Nom
                            </label>
                            <input
                              type="text"
                              value={contact.name}
                              onChange={(e) => updateContact(index, 'name', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                              Poste
                            </label>
                            <input
                              type="text"
                              value={contact.position}
                              onChange={(e) => updateContact(index, 'position', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                              Email
                            </label>
                            <input
                              type="email"
                              value={contact.email}
                              onChange={(e) => updateContact(index, 'email', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                              Téléphone
                            </label>
                            <input
                              type="tel"
                              value={contact.phone}
                              onChange={(e) => updateContact(index, 'phone', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-6 py-2 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200 font-medium"
                >
                  Créer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Nom
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Téléphone
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Ville
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Pays
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {filteredClients.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-6 py-12 text-center">
                    <div className="text-4xl mb-2">👥</div>
                    <p className="text-gray-500 dark:text-gray-400">
                      {clients.length === 0 ? 'Aucun client trouvé' : 'Aucun client ne correspond aux critères de recherche'}
                    </p>
                    {(searchQuery || filterCity || filterCountry) && clients.length > 0 && (
                      <button
                        onClick={handleResetFilters}
                        className="mt-4 px-4 py-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Réinitialiser les filtres
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                filteredClients.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map(client => (
                  <tr key={client.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="font-medium text-gray-900 dark:text-white">{client.name}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-600 dark:text-gray-400">
                      {client.email}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-600 dark:text-gray-400">
                      {client.phone || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-600 dark:text-gray-400">
                      {client.city || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-600 dark:text-gray-400">
                      {client.country || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-3">
                      <button 
                        onClick={() => handleViewClient(client.id)}
                        className="text-blue-600 hover:text-blue-800 dark:text-blue-400"
                        title="Voir les détails"
                      >
                        👁️
                      </button>
                      <button 
                        onClick={() => handleViewClient(client.id)}
                        className="text-blue-600 hover:text-blue-800 dark:text-blue-400"
                        title="Modifier"
                      >
                        ✏️
                      </button>
                      <button 
                        onClick={() => handleDelete(client.id)}
                        className="text-red-600 hover:text-red-800 dark:text-red-400"
                        title="Supprimer"
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        
        {filteredClients.length > 0 && (
          <Pagination
            currentPage={currentPage}
            totalPages={Math.ceil(filteredClients.length / itemsPerPage)}
            onPageChange={(page) => {
              setCurrentPage(page);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        )}
      </div>
    </div>
  );
}

// Page de détail Produit
function ProductDetailPage({ product, onBack, onUpdate }) {
  const [showEditModal, setShowEditModal] = useState(false);
  const [categories, setCategories] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [vatRates, setVatRates] = useState([]);
  const [formData, setFormData] = useState({
    reference: product.reference || '',
    name: product.name || '',
    description: product.description || '',
    category_id: product.category_id || '',
    price_ht: product.price_ht || '',
    vat_rate_id: product.vat_rate_id || '',
    currency_id: product.currency_id || ''
  });

  useEffect(() => {
    loadCategories();
    loadCurrencies();
    loadVatRates();
  }, []);

  const loadCategories = async () => {
    try {
      const data = await api.get('/config/categories');
      setCategories(data);
    } catch (error) {
      console.error('Erreur chargement catégories:', error);
    }
  };

  const loadCurrencies = async () => {
    try {
      const data = await api.get('/config/currencies');
      setCurrencies(data);
    } catch (error) {
      console.error('Erreur chargement devises:', error);
    }
  };

  const loadVatRates = async () => {
    try {
      const data = await api.get('/config/vat-rates');
      setVatRates(data);
    } catch (error) {
      console.error('Erreur chargement taux TVA:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const updatedProduct = await api.put(`/products/${product.id}`, {
        ...formData,
        category_id: formData.category_id || null,
        vat_rate_id: formData.vat_rate_id || null,
        currency_id: formData.currency_id || null,
        price_ht: parseFloat(formData.price_ht) || 0
      });
      setShowEditModal(false);
      if (onUpdate) {
        onUpdate(updatedProduct);
      }
    } catch (error) {
      console.error('Erreur modification produit:', error);
      alert('Erreur lors de la modification du produit');
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const priceHT = parseFloat(product.price_ht) || 0;
  const vatRate = parseFloat(product.vat_rate) || 0;
  const prixTTC = priceHT * (1 + vatRate / 100);

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex justify-between items-start mb-8">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          >
            ←
          </button>
          <div>
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white">{product.name}</h2>
            <p className="text-gray-500 dark:text-gray-400 mt-1">Fiche produit détaillée</p>
          </div>
        </div>
        <button 
          onClick={() => setShowEditModal(true)}
          className="px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200 font-medium flex items-center gap-2"
        >
          <span>✏️</span>
          Modifier
        </button>
      </div>

      <div className="space-y-6">
        {/* Informations générales */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Informations générales
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Détails et caractéristiques du produit
          </p>
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <span className="text-gray-500 dark:text-gray-400 mt-1">🔖</span>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Référence</p>
                <p className="text-gray-900 dark:text-white font-medium">{product.reference || '-'}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-gray-500 dark:text-gray-400 mt-1">📦</span>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Nom</p>
                <p className="text-gray-900 dark:text-white font-medium">{product.name || '-'}</p>
              </div>
            </div>
            {product.description && (
              <div className="flex items-start gap-3">
                <span className="text-gray-500 dark:text-gray-400 mt-1">📝</span>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Description</p>
                  <p className="text-gray-900 dark:text-white font-medium">{product.description}</p>
                </div>
              </div>
            )}
            {product.category_name && (
              <div className="flex items-start gap-3">
                <span className="text-gray-500 dark:text-gray-400 mt-1">🏷️</span>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Catégorie</p>
                  <p className="text-gray-900 dark:text-white font-medium">{product.category_name}</p>
                </div>
              </div>
            )}
            <div className="flex items-start gap-3">
              <span className="text-gray-500 dark:text-gray-400 mt-1">📅</span>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Date de création</p>
                <p className="text-gray-900 dark:text-white font-medium">{formatDate(product.created_at)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Informations tarifaires */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Informations tarifaires
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Prix et taxes du produit
          </p>
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <span className="text-gray-500 dark:text-gray-400 mt-1">💰</span>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Prix HT</p>
                <p className="text-gray-900 dark:text-white font-medium">
                  {isNaN(priceHT) ? '-' : priceHT.toFixed(2)} {product.currency_symbol || '€'}
                </p>
              </div>
            </div>
            {product.vat_rate && (
              <div className="flex items-start gap-3">
                <span className="text-gray-500 dark:text-gray-400 mt-1">📊</span>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Taux de TVA</p>
                  <p className="text-gray-900 dark:text-white font-medium">
                    {vatRate}% {product.vat_rate_label ? `(${product.vat_rate_label})` : ''}
                  </p>
                </div>
              </div>
            )}
            <div className="flex items-start gap-3">
              <span className="text-gray-500 dark:text-gray-400 mt-1">💵</span>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Prix TTC</p>
                <p className="text-gray-900 dark:text-white font-medium text-xl">
                  {isNaN(prixTTC) ? '-' : prixTTC.toFixed(2)} {product.currency_symbol || '€'}
                </p>
              </div>
            </div>
            {product.currency_code && (
              <div className="flex items-start gap-3">
                <span className="text-gray-500 dark:text-gray-400 mt-1">💱</span>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Devise</p>
                  <p className="text-gray-900 dark:text-white font-medium">
                    {product.currency_code} ({product.currency_symbol}) - {product.currency_name}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal Modification Produit */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">Modifier le produit</h3>
              <button
                onClick={() => setShowEditModal(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Référence *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.reference}
                    onChange={(e) => setFormData({...formData, reference: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="PRD-001"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Nom *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="Nom du produit"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="Description du produit"
                  rows="3"
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Catégorie
                  </label>
                  <select
                    value={formData.category_id}
                    onChange={(e) => setFormData({...formData, category_id: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  >
                    <option value="">Sélectionner...</option>
                    {categories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Devise
                  </label>
                  <select
                    value={formData.currency_id}
                    onChange={(e) => setFormData({...formData, currency_id: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  >
                    <option value="">Sélectionner...</option>
                    {currencies.map(curr => (
                      <option key={curr.id} value={curr.id}>{curr.code} ({curr.symbol})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Taux de TVA
                  </label>
                  <select
                    value={formData.vat_rate_id}
                    onChange={(e) => setFormData({...formData, vat_rate_id: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  >
                    <option value="">Sélectionner...</option>
                    {vatRates.map(vat => (
                      <option key={vat.id} value={vat.id}>{vat.rate}% - {vat.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Prix HT *
                </label>
                <input
                  type="number"
                  required
                  step="0.01"
                  min="0"
                  value={formData.price_ht}
                  onChange={(e) => setFormData({...formData, price_ht: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="0.00"
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200 font-medium"
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Page Produits
function ProductsPage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterCurrency, setFilterCurrency] = useState('');
  const [categories, setCategories] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [vatRates, setVatRates] = useState([]);
  const [formData, setFormData] = useState({
    reference: '',
    name: '',
    description: '',
    category_id: '',
    price_ht: '',
    vat_rate_id: '',
    currency_id: ''
  });
  const [editFormData, setEditFormData] = useState({
    reference: '',
    name: '',
    description: '',
    category_id: '',
    price_ht: '',
    vat_rate_id: '',
    currency_id: ''
  });

  useEffect(() => {
    loadProducts();
    loadCategories();
    loadCurrencies();
    loadVatRates();
  }, []);

  const loadProducts = async () => {
    try {
      setError(null);
      setLoading(true);
      const data = await api.get('/products');
      if (Array.isArray(data)) {
      setProducts(data);
      } else {
        console.error('Données invalides reçues:', data);
        setProducts([]);
        setError('Format de données invalide');
      }
    } catch (error) {
      console.error('Erreur chargement produits:', error);
      setError('Erreur lors du chargement des produits');
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    try {
      const data = await api.get('/config/categories');
      setCategories(data);
    } catch (error) {
      console.error('Erreur chargement catégories:', error);
    }
  };

  const loadCurrencies = async () => {
    try {
      const data = await api.get('/config/currencies');
      setCurrencies(data);
    } catch (error) {
      console.error('Erreur chargement devises:', error);
    }
  };

  const loadVatRates = async () => {
    try {
      const data = await api.get('/config/vat-rates');
      setVatRates(data);
    } catch (error) {
      console.error('Erreur chargement taux TVA:', error);
    }
  };

  // Filtrer les produits
  const filteredProducts = products.filter(product => {
    // Recherche textuelle
    const matchesSearch = searchQuery === '' || 
      product.reference?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.description?.toLowerCase().includes(searchQuery.toLowerCase());
    
    // Filtre par catégorie
    const matchesCategory = filterCategory === '' || 
      product.category_id?.toString() === filterCategory;
    
    // Filtre par devise
    const matchesCurrency = filterCurrency === '' || 
      product.currency_id?.toString() === filterCurrency;
    
    return matchesSearch && matchesCategory && matchesCurrency;
  });

  // Réinitialiser les filtres
  const handleResetFilters = () => {
    setSearchQuery('');
    setFilterCategory('');
    setFilterCurrency('');
    setCurrentPage(1);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Confirmer la suppression de ce produit ?')) return;
    
    try {
      await api.delete(`/products/${id}`);
      loadProducts();
      // Réinitialiser à la première page si on supprime le dernier élément de la dernière page
      const maxPage = Math.ceil((filteredProducts.length - 1) / itemsPerPage);
      if (currentPage > maxPage && maxPage > 0) {
        setCurrentPage(maxPage);
      }
    } catch (error) {
      console.error('Erreur suppression:', error);
      alert('Erreur lors de la suppression');
    }
  };

  const handleViewProduct = async (id) => {
    try {
      const product = await api.get(`/products/${id}`);
      setSelectedProduct(product);
    } catch (error) {
      console.error('Erreur chargement produit:', error);
      alert('Erreur lors du chargement des détails du produit');
    }
  };

  const handleEditProduct = async (id) => {
    try {
      const product = await api.get(`/products/${id}`);
      setEditingProduct(product);
      setEditFormData({
        reference: product.reference || '',
        name: product.name || '',
        description: product.description || '',
        category_id: product.category_id || '',
        price_ht: product.price_ht || '',
        vat_rate_id: product.vat_rate_id || '',
        currency_id: product.currency_id || ''
      });
      setShowEditModal(true);
    } catch (error) {
      console.error('Erreur chargement produit:', error);
      alert('Erreur lors du chargement des détails du produit');
    }
  };

  const handleUpdateProduct = async (e) => {
    e.preventDefault();
    try {
      await api.put(`/products/${editingProduct.id}`, {
        ...editFormData,
        category_id: editFormData.category_id || null,
        vat_rate_id: editFormData.vat_rate_id || null,
        currency_id: editFormData.currency_id || null,
        price_ht: parseFloat(editFormData.price_ht) || 0
      });
      setShowEditModal(false);
      setEditingProduct(null);
      setEditFormData({
        reference: '',
        name: '',
        description: '',
        category_id: '',
        price_ht: '',
        vat_rate_id: '',
        currency_id: ''
      });
      loadProducts();
    } catch (error) {
      console.error('Erreur modification produit:', error);
      alert('Erreur lors de la modification du produit');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/products', {
        ...formData,
        category_id: formData.category_id || null,
        vat_rate_id: formData.vat_rate_id || null,
        currency_id: formData.currency_id || null,
        price_ht: parseFloat(formData.price_ht) || 0
      });
      setShowModal(false);
      setFormData({
        reference: '',
        name: '',
        description: '',
        category_id: '',
        price_ht: '',
        vat_rate_id: '',
        currency_id: ''
      });
      loadProducts();
      setCurrentPage(1); // Réinitialiser à la première page après création
    } catch (error) {
      console.error('Erreur création produit:', error);
      alert('Erreur lors de la création du produit');
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-4xl mb-4">⏳</div>
          <p className="text-gray-500">Chargement des produits...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-4xl mb-4">❌</div>
          <p className="text-red-500 mb-4">{error}</p>
          <button
            onClick={loadProducts}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  // Afficher la page de détail si un produit est sélectionné
  if (selectedProduct) {
    return (
      <ProductDetailPage 
        product={selectedProduct} 
        onBack={() => setSelectedProduct(null)}
        onUpdate={async (updatedProduct) => {
          // Recharger le produit avec les données mises à jour
          try {
            const product = await api.get(`/products/${updatedProduct.id}`);
            setSelectedProduct(product);
          } catch (error) {
            console.error('Erreur chargement produit:', error);
            setSelectedProduct(updatedProduct);
          }
          loadProducts(); // Recharger la liste pour mettre à jour les données
        }}
      />
    );
  }

  return (
    <div className="p-8">
      <header className="mb-8 flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white">Produits</h2>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Gérez vos catégories et produits</p>
        </div>
        <button 
          onClick={() => setShowModal(true)}
          className="px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium flex items-center gap-2"
        >
          <span>➕</span>
          Nouveau produit
        </button>
      </header>

      {/* Barre de recherche et filtres */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Recherche */}
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              🔍 Recherche
            </label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1); // Réinitialiser à la première page lors de la recherche
              }}
              placeholder="Rechercher par référence, nom ou description..."
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            />
          </div>

          {/* Filtre par catégorie */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              📦 Catégorie
            </label>
            <select
              value={filterCategory}
              onChange={(e) => {
                setFilterCategory(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            >
              <option value="">Toutes les catégories</option>
              {categories.map(category => (
                <option key={category.id} value={category.id.toString()}>{category.name}</option>
              ))}
            </select>
          </div>

          {/* Filtre par devise */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              💰 Devise
            </label>
            <select
              value={filterCurrency}
              onChange={(e) => {
                setFilterCurrency(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            >
              <option value="">Toutes les devises</option>
              {currencies.map(currency => (
                <option key={currency.id} value={currency.id.toString()}>{currency.code} ({currency.symbol})</option>
              ))}
            </select>
          </div>
        </div>

        {/* Bouton réinitialiser les filtres */}
        {(searchQuery || filterCategory || filterCurrency) && (
          <div className="mt-4 flex justify-end">
            <button
              onClick={handleResetFilters}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
            >
              <span>↻</span>
              Réinitialiser les filtres
            </button>
          </div>
        )}

        {/* Affichage du nombre de résultats */}
        <div className="mt-4 text-sm text-gray-500 dark:text-gray-400">
          {filteredProducts.length === products.length ? (
            <span>{products.length} produit{products.length > 1 ? 's' : ''} au total</span>
          ) : (
            <span>
              {filteredProducts.length} produit{filteredProducts.length > 1 ? 's' : ''} trouvé{filteredProducts.length > 1 ? 's' : ''} 
              {' '}sur {products.length} au total
            </span>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Référence
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Nom
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Catégorie
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Prix HT
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  TVA
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Prix TTC
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-6 py-12 text-center">
                    <div className="text-4xl mb-2">📦</div>
                    <p className="text-gray-500 dark:text-gray-400">
                      {products.length === 0 ? 'Aucun produit trouvé' : 'Aucun produit ne correspond aux critères de recherche'}
                    </p>
                    {(searchQuery || filterCategory || filterCurrency) && products.length > 0 && (
                      <button
                        onClick={handleResetFilters}
                        className="mt-4 px-4 py-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Réinitialiser les filtres
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                filteredProducts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map(product => {
                  const priceHT = parseFloat(product.price_ht) || 0;
                  const vatRate = parseFloat(product.vat_rate) || 0;
                  const prixTTC = priceHT * (1 + vatRate / 100);
                  return (
                    <tr key={product.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="font-medium text-gray-900 dark:text-white">{product.reference || '-'}</div>
                      </td>
                      <td className="px-6 py-4 text-gray-600 dark:text-gray-400">
                        {product.name || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-gray-600 dark:text-gray-400">
                        {product.category_name || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-gray-900 dark:text-white">
                        {isNaN(priceHT) ? '-' : priceHT.toFixed(2)} {product.currency_symbol || '€'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-gray-600 dark:text-gray-400">
                        {isNaN(vatRate) ? '-' : vatRate}%
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right font-semibold text-gray-900 dark:text-white">
                        {isNaN(prixTTC) ? '-' : prixTTC.toFixed(2)} {product.currency_symbol || '€'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-3">
                        <button 
                          onClick={() => handleViewProduct(product.id)}
                          className="text-blue-600 hover:text-blue-800 dark:text-blue-400"
                          title="Voir les détails"
                        >
                          👁️
                        </button>
                        <button 
                          onClick={() => handleEditProduct(product.id)}
                          className="text-blue-600 hover:text-blue-800 dark:text-blue-400"
                          title="Modifier"
                        >
                          ✏️
                        </button>
                        <button 
                          onClick={() => handleDelete(product.id)}
                          className="text-red-600 hover:text-red-800 dark:text-red-400"
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {filteredProducts.length > 0 && (
          <Pagination
            currentPage={currentPage}
            totalPages={Math.ceil(filteredProducts.length / itemsPerPage)}
            onPageChange={(page) => {
              setCurrentPage(page);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        )}
      </div>

      {/* Modal Nouveau Produit */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">Nouveau produit</h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Référence *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.reference}
                    onChange={(e) => setFormData({...formData, reference: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="PRD-001"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Nom *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="Nom du produit"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="Description du produit"
                  rows="3"
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Catégorie
                  </label>
                  <select
                    value={formData.category_id}
                    onChange={(e) => setFormData({...formData, category_id: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  >
                    <option value="">Sélectionner...</option>
                    {categories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Devise
                  </label>
                  <select
                    value={formData.currency_id}
                    onChange={(e) => setFormData({...formData, currency_id: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  >
                    <option value="">Sélectionner...</option>
                    {currencies.map(curr => (
                      <option key={curr.id} value={curr.id}>{curr.code} ({curr.symbol})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Taux de TVA
                  </label>
                  <select
                    value={formData.vat_rate_id}
                    onChange={(e) => setFormData({...formData, vat_rate_id: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  >
                    <option value="">Sélectionner...</option>
                    {vatRates.map(vat => (
                      <option key={vat.id} value={vat.id}>{vat.rate}% - {vat.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Prix HT *
                </label>
                <input
                  type="number"
                  required
                  step="0.01"
                  min="0"
                  value={formData.price_ht}
                  onChange={(e) => setFormData({...formData, price_ht: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="0.00"
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                >
                  Créer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Modification Produit */}
      {showEditModal && editingProduct && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">Modifier le produit</h3>
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setEditingProduct(null);
                }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleUpdateProduct} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Référence *
                  </label>
                  <input
                    type="text"
                    required
                    value={editFormData.reference}
                    onChange={(e) => setEditFormData({...editFormData, reference: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="PRD-001"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Nom *
                  </label>
                  <input
                    type="text"
                    required
                    value={editFormData.name}
                    onChange={(e) => setEditFormData({...editFormData, name: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="Nom du produit"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Description
                </label>
                <textarea
                  value={editFormData.description}
                  onChange={(e) => setEditFormData({...editFormData, description: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="Description du produit"
                  rows="3"
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Catégorie
                  </label>
                  <select
                    value={editFormData.category_id}
                    onChange={(e) => setEditFormData({...editFormData, category_id: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  >
                    <option value="">Sélectionner...</option>
                    {categories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Devise
                  </label>
                  <select
                    value={editFormData.currency_id}
                    onChange={(e) => setEditFormData({...editFormData, currency_id: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  >
                    <option value="">Sélectionner...</option>
                    {currencies.map(curr => (
                      <option key={curr.id} value={curr.id}>{curr.code} ({curr.symbol})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Taux de TVA
                  </label>
                  <select
                    value={editFormData.vat_rate_id}
                    onChange={(e) => setEditFormData({...editFormData, vat_rate_id: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  >
                    <option value="">Sélectionner...</option>
                    {vatRates.map(vat => (
                      <option key={vat.id} value={vat.id}>{vat.rate}% - {vat.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Prix HT *
                </label>
                <input
                  type="number"
                  required
                  step="0.01"
                  min="0"
                  value={editFormData.price_ht}
                  onChange={(e) => setEditFormData({...editFormData, price_ht: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="0.00"
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditModal(false);
                    setEditingProduct(null);
                  }}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Page Devis
function QuotesPage({ user, quoteToOpen, onQuoteOpened }) {
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreatePage, setShowCreatePage] = useState(false);
  const [showDetailPage, setShowDetailPage] = useState(false);
  const [selectedQuote, setSelectedQuote] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [searchQuery, setSearchQuery] = useState('');
  const [filterClient, setFilterClient] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [editingQuote, setEditingQuote] = useState(null);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [recipientEmails, setRecipientEmails] = useState([]); // liste d'emails sélectionnés
  const [emailInputMode, setEmailInputMode] = useState('select'); // 'select' ou 'manual'
  const [manualEmailInput, setManualEmailInput] = useState(''); // champ de saisie libre (peut contenir plusieurs emails séparés par ;)
  const [emailMessage, setEmailMessage] = useState(''); // message personnalisé
  const [sendingEmail, setSendingEmail] = useState(false);
  const [notification, setNotification] = useState(null); // { type: 'success' | 'error', message: string }
  const [showAttachmentModal, setShowAttachmentModal] = useState(false);
  const [showViewAttachmentModal, setShowViewAttachmentModal] = useState(false);
  const [viewingAttachment, setViewingAttachment] = useState(null);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [comments, setComments] = useState([]);
  const [users, setUsers] = useState([]);
  const [showCommentModal, setShowCommentModal] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [assignedToUserId, setAssignedToUserId] = useState('');
  const quoteRef = useRef(null);
  const page1Ref = useRef(null);
  const page2Ref = useRef(null);
  const [printClient, setPrintClient] = useState(null);
  const [userWithSignature, setUserWithSignature] = useState(null);
  const [clients, setClients] = useState([]);
  const [products, setProducts] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [layoutConfig, setLayoutConfig] = useState({
    logo_url: '',
    logo_file_path: null,
    footer_text: ''
  });
  const [formData, setFormData] = useState({
    quote_number: '',
    client_id: '',
    date: new Date().toISOString().split('T')[0],
    valid_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    status: 'pending',
    currency_id: '',
    conditions_generales: '',
    first_page_text: '',
    introduction_text: '',
    global_discount_percent: 0,
    global_discount_type: '%',
    mode_calcul: 'ttc'
  });
  const [quoteItems, setQuoteItems] = useState([]);

  // Normalise une date provenant de l'API pour l'affichage dans un input type="date"
  const formatDateForInput = (value) => {
    if (!value) return '';
    // Si c'est déjà au format YYYY-MM-DD, on le garde tel quel
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }
    // Sinon, on tente de parser et de reformater
    const d = new Date(value);
    if (isNaN(d.getTime())) {
      return '';
    }
    return d.toISOString().split('T')[0];
  };

  useEffect(() => {
    loadQuotes();
    if (showCreatePage || editingQuote) {
      loadClients();
      loadProducts();
      loadCurrencies();
    }
  }, [showCreatePage, editingQuote]);

  // Charger la configuration de mise en page (logo entreprise + pied de page)
  useEffect(() => {
    const loadLayoutConfig = async () => {
      try {
        const layout = await api.get('/config/layout');
        if (layout && Object.keys(layout).length > 0) {
          // Reconstruire une URL de prévisualisation si un fichier de logo est enregistré
          let logo_preview = '';
          if (layout.logo_file_path) {
            const baseUrl = API_URL.replace('/api', '');
            const relativePath = layout.logo_file_path.replace(/^uploads[\\/]/, '');
            logo_preview = `${baseUrl}/uploads/${relativePath}`;
          }
          setLayoutConfig({
            logo_url: layout.logo_url || '',
            logo_file_path: layout.logo_file_path || null,
            footer_text: layout.footer_text || '',
            logo_preview
          });
        }
      } catch (error) {
        console.error('Erreur chargement mise en page:', error);
      }
    };

    loadLayoutConfig();
  }, []);

  // Ouvrir un devis si spécifié (depuis une notification)
  useEffect(() => {
    if (quoteToOpen && quoteToOpen.quoteId) {
      handleViewQuote(quoteToOpen.quoteId);
      if (onQuoteOpened) {
        onQuoteOpened();
      }
    }
  }, [quoteToOpen]);

  const loadQuotes = async () => {
    try {
      const data = await api.get('/quotes');
      setQuotes(data);
    } catch (error) {
      console.error('Erreur chargement devis:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadClients = async () => {
    try {
      const data = await api.get('/clients');
      setClients(data);
    } catch (error) {
      console.error('Erreur chargement clients:', error);
    }
  };

  const loadProducts = async () => {
    try {
      const data = await api.get('/products');
      setProducts(data);
    } catch (error) {
      console.error('Erreur chargement produits:', error);
    }
  };

  const loadCurrencies = async () => {
    try {
      const data = await api.get('/config/currencies');
      setCurrencies(data);
    } catch (error) {
      console.error('Erreur chargement devises:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingQuote) {
        // Modification
        await api.put(`/quotes/${editingQuote.id}`, {
          ...formData,
          items: quoteItems
        });
        setEditingQuote(null);
        setShowCreatePage(false);
      } else {
        // Création
        await api.post('/quotes', {
          ...formData,
          items: quoteItems
        });
        setShowCreatePage(false);
      }
      resetForm();
      loadQuotes();
    } catch (error) {
      console.error('Erreur sauvegarde devis:', error);
      alert('Erreur lors de la sauvegarde du devis');
    }
  };

  const resetForm = () => {
    setFormData({
      quote_number: '',
      client_id: '',
      date: new Date().toISOString().split('T')[0],
      valid_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      status: 'pending',
      currency_id: '',
      conditions_generales: '',
      first_page_text: '',
      introduction_text: '',
      global_discount_percent: 0,
      global_discount_type: '%',
      mode_calcul: 'ttc'
    });
    setQuoteItems([]);
  };

  const loadUsers = async () => {
    try {
      const data = await api.get('/users');
      setUsers(data);
    } catch (error) {
      console.error('Erreur chargement utilisateurs:', error);
    }
  };

  const handleViewQuote = async (id) => {
    try {
      const quote = await api.get(`/quotes/${id}`);
      setSelectedQuote(quote);
      setAttachments(quote.attachments || []);
      setComments(quote.comments || []);
      setPrintClient(null);
      // Charger le client du devis pour récupérer le logo
      if (quote.client_id) {
        try {
          const clientData = await api.get(`/clients/${quote.client_id}`);
          setPrintClient(clientData);
        } catch (e) {
          console.error('Erreur chargement client pour le devis:', e);
        }
      }
      // Charger les informations complètes de l'utilisateur avec la signature
      if (user?.id) {
        try {
          const userData = await api.get(`/auth/profile?userId=${user.id}`);
          setUserWithSignature(userData);
        } catch (e) {
          console.error('Erreur chargement utilisateur avec signature:', e);
          setUserWithSignature(user); // Fallback sur l'utilisateur de base
        }
      }

      // Charger les produits pour pouvoir afficher la description dans le détail du devis
      if (products.length === 0) {
        loadProducts();
      }
      setShowDetailPage(true);
      // Charger les utilisateurs si pas déjà chargés
      if (users.length === 0) {
        loadUsers();
      }
    } catch (error) {
      console.error('Erreur chargement devis:', error);
      alert('Erreur lors du chargement des détails du devis');
    }
  };

  const handleCreateComment = async (e) => {
    e.preventDefault();
    if (!commentText.trim()) {
      showNotification('error', 'Veuillez saisir un commentaire');
      return;
    }
    
    try {
      const response = await api.post(`/quotes/${selectedQuote.id}/comments`, {
        userId: user?.id,
        assignedToUserId: assignedToUserId || null,
        comment: commentText
      });
      
      // Recharger les commentaires depuis le serveur pour avoir toutes les infos
      const quote = await api.get(`/quotes/${selectedQuote.id}`);
      setComments(quote.comments || []);
      setSelectedQuote(quote);
      
      setCommentText('');
      setAssignedToUserId('');
      setShowCommentModal(false);
      showNotification('success', 'Commentaire ajouté avec succès' + (assignedToUserId ? ' et notification envoyée' : ''));
    } catch (error) {
      console.error('Erreur création commentaire:', error);
      showNotification('error', error.message || 'Erreur lors de la création du commentaire');
    }
  };

  const handleUploadAttachments = async (event) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    
    setUploadingFiles(true);
    try {
      const formData = new FormData();
      Array.from(files).forEach(file => {
        formData.append('files', file);
      });
      
      const response = await fetch(`${API_URL}/quotes/${selectedQuote.id}/attachments`, {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Erreur serveur' }));
        throw new Error(errorData.error || 'Erreur lors de l\'upload');
      }
      
      const newAttachments = await response.json();
      setAttachments([...attachments, ...newAttachments]);
      setShowAttachmentModal(false);
      // Réinitialiser l'input file
      event.target.value = '';
    } catch (error) {
      console.error('Erreur upload pièces jointes:', error);
      alert('Erreur lors de l\'upload des pièces jointes: ' + error.message);
    } finally {
      setUploadingFiles(false);
    }
  };

  const handleDownloadAttachment = async (attachmentId) => {
    try {
      window.open(`${API_URL}/quotes/${selectedQuote.id}/attachments/${attachmentId}/download`, '_blank');
    } catch (error) {
      console.error('Erreur téléchargement pièce jointe:', error);
      alert('Erreur lors du téléchargement');
    }
  };

  const handleViewAttachment = (attachment) => {
    setViewingAttachment(attachment);
    setShowViewAttachmentModal(true);
  };

  const getAttachmentViewUrl = (attachmentId) => {
    return `${API_URL}/quotes/${selectedQuote.id}/attachments/${attachmentId}/download`;
  };

  const isImageFile = (mimeType) => {
    return mimeType && mimeType.startsWith('image/');
  };

  const isPdfFile = (mimeType) => {
    return mimeType === 'application/pdf';
  };

  const isTextFile = (mimeType) => {
    return mimeType && (mimeType.startsWith('text/') || mimeType === 'application/json');
  };

  const handleDeleteAttachment = async (attachmentId) => {
    if (!window.confirm('Êtes-vous sûr de vouloir supprimer cette pièce jointe ?')) {
      return;
    }
    
    try {
      await api.delete(`/quotes/${selectedQuote.id}/attachments/${attachmentId}`);
      setAttachments(attachments.filter(a => a.id !== attachmentId));
    } catch (error) {
      console.error('Erreur suppression pièce jointe:', error);
      alert('Erreur lors de la suppression de la pièce jointe');
    }
  };

  const handleEditQuote = async (id) => {
    try {
      const quote = await api.get(`/quotes/${id}`);
      setEditingQuote(quote);
      setFormData({
        quote_number: quote.quote_number || '',
        client_id: quote.client_id || '',
        // Utiliser toujours la date/validité initialement saisies, normalisées pour l'input date
        date: formatDateForInput(quote.date) || new Date().toISOString().split('T')[0],
        valid_until:
          formatDateForInput(quote.valid_until) ||
          new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        status: quote.status || 'pending',
        currency_id: quote.currency_id || '',
        conditions_generales: quote.conditions_generales || '',
        first_page_text: quote.first_page_text || '',
        introduction_text: quote.introduction_text || '',
        global_discount_percent: quote.global_discount_percent || 0,
        global_discount_type: '%',
        mode_calcul: quote.mode_calcul === 'ht' ? 'ht' : 'ttc'
      });
      setQuoteItems(quote.items || []);
      setShowDetailPage(false);
      setShowCreatePage(true);
    } catch (error) {
      console.error('Erreur chargement devis:', error);
      alert('Erreur lors du chargement du devis pour modification');
    }
  };

  // Filtrer les devis
  const filteredQuotes = quotes.filter(quote => {
    // Recherche textuelle (numéro ou client)
    const matchesSearch = searchQuery === '' || 
      (quote.quote_number || quote.id.toString())?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      quote.client_name?.toLowerCase().includes(searchQuery.toLowerCase());
    
    // Filtre par client
    const matchesClient = filterClient === '' || 
      quote.client_id?.toString() === filterClient;
    
    // Filtre par statut
    const matchesStatus = filterStatus === '' || 
      (quote.status || 'pending') === filterStatus;
    
    // Filtre par date
    let matchesDate = true;
    if (filterDateFrom) {
      const quoteDate = quote.date ? new Date(quote.date) : null;
      const fromDate = new Date(filterDateFrom);
      if (!quoteDate || quoteDate < fromDate) {
        matchesDate = false;
      }
    }
    if (filterDateTo) {
      const quoteDate = quote.date ? new Date(quote.date) : null;
      const toDate = new Date(filterDateTo);
      toDate.setHours(23, 59, 59, 999); // Fin de journée
      if (!quoteDate || quoteDate > toDate) {
        matchesDate = false;
      }
    }
    
    return matchesSearch && matchesClient && matchesStatus && matchesDate;
  });

  // Réinitialiser les filtres
  const handleResetFilters = () => {
    setSearchQuery('');
    setFilterClient('');
    setFilterStatus('');
    setFilterDateFrom('');
    setFilterDateTo('');
    setCurrentPage(1);
  };

  // Obtenir les clients uniques pour le filtre
  const uniqueClients = [...new Map(quotes.map(q => [q.client_id, { id: q.client_id, name: q.client_name }]).filter(([id]) => id)).values()];

  // Statuts disponibles
  const statusOptions = [
    { value: 'pending', label: 'En attente' },
    { value: 'created', label: 'Créé' },
    { value: 'sent', label: 'Envoyé' },
    { value: 'accepted', label: 'Accepté' },
    { value: 'rejected', label: 'Refusé' },
    { value: 'confirmed', label: 'Confirmé' }
  ];

  const getStatusLabel = (status) => {
    const opt = statusOptions.find((s) => s.value === status);
    return opt ? opt.label : status;
  };

  const handleDeleteQuote = async (id) => {
    if (!window.confirm('Êtes-vous sûr de vouloir supprimer ce devis ?')) {
      return;
    }
    try {
      await api.delete(`/quotes/${id}`);
      loadQuotes();
      // Réinitialiser à la première page si on supprime le dernier élément de la dernière page
      const maxPage = Math.ceil((filteredQuotes.length - 1) / itemsPerPage);
      if (currentPage > maxPage && maxPage > 0) {
        setCurrentPage(maxPage);
      }
      if (selectedQuote && selectedQuote.id === id) {
        setShowDetailPage(false);
        setSelectedQuote(null);
      }
    } catch (error) {
      console.error('Erreur suppression devis:', error);
      alert('Erreur lors de la suppression du devis');
    }
  };

  const handlePrintPDF = async () => {
    if (!page1Ref.current || !page2Ref.current) return;
    
    try {
      // Attendre que les images (logos, signature) soient chargées pour que html2canvas puisse les dessiner
      const waitForImages = (el) => {
        const imgs = el.querySelectorAll('img[src]');
        return Promise.all(Array.from(imgs).map((img) => {
          if (img.complete && img.naturalHeight !== 0) return Promise.resolve();
          return new Promise((resolve) => {
            img.onload = resolve;
            img.onerror = resolve;
            if (img.complete) resolve();
          });
        }));
      };
      await waitForImages(page1Ref.current);
      await waitForImages(page2Ref.current);

      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = 210; // Largeur A4 en mm
      const pageHeight = 297; // Hauteur A4 en mm
      const margin = 15; // Marge de 15mm de chaque côté
      const contentWidth = pageWidth - (margin * 2); // Largeur du contenu avec marges
      
      // Capturer la première page
      const canvas1 = await html2canvas(page1Ref.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false
      });
      
      const imgData1 = canvas1.toDataURL('image/png');
      const imgHeight1 = (canvas1.height * contentWidth) / canvas1.width;
      
      // Ajouter la première page au PDF avec marges
      pdf.addImage(imgData1, 'PNG', margin, margin, contentWidth, imgHeight1);
      
      // Capturer la deuxième page
      const canvas2 = await html2canvas(page2Ref.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false
      });
      
      const imgData2 = canvas2.toDataURL('image/png');
      const imgHeight2 = (canvas2.height * contentWidth) / canvas2.width;
      
      // Ajouter la deuxième page au PDF avec marges
        pdf.addPage();
      pdf.addImage(imgData2, 'PNG', margin, margin, contentWidth, imgHeight2);
      
      pdf.save(`Devis-${selectedQuote.quote_number}.pdf`);
    } catch (error) {
      console.error('Erreur génération PDF:', error);
      alert('Erreur lors de la génération du PDF');
    }
  };

  const showNotification = (type, message) => {
    setNotification({ type, message });
    // Disparaît automatiquement après 5 secondes
    setTimeout(() => {
      setNotification(null);
    }, 5000);
  };

  const handleSendEmail = async () => {
    // Validation des destinataires
    if (!Array.isArray(recipientEmails) || recipientEmails.length === 0) {
      showNotification('error', 'Veuillez saisir ou sélectionner au moins une adresse email valide');
      return;
    }

    const invalidEmails = recipientEmails.filter(
      (email) => !email || !email.includes('@')
    );
    if (invalidEmails.length > 0) {
      showNotification('error', 'Une ou plusieurs adresses email ne sont pas valides');
      return;
    }
    
    setSendingEmail(true);
    try {
      const response = await fetch(`${API_URL}/quotes/${selectedQuote.id}/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          recipientEmails,
          message: emailMessage || ''
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de l\'envoi de l\'email');
      }
      
      showNotification('success', 'Devis envoyé par email avec succès');
      setShowEmailModal(false);
      setRecipientEmails([]);
      setEmailMessage('');
      setEmailInputMode('select');
    } catch (error) {
      console.error('Erreur envoi email:', error);
      const errorMessage = error.message || 'Erreur lors de l\'envoi de l\'email';
      showNotification('error', errorMessage);
    } finally {
      setSendingEmail(false);
    }
  };

  // Préparer la liste des emails disponibles
  const getAvailableEmails = () => {
    const emails = [];
    
    // Email du client
    if (selectedQuote?.client_email) {
      emails.push({
        value: selectedQuote.client_email,
        label: `${selectedQuote.client_name || 'Client'} (${selectedQuote.client_email})`,
        type: 'client'
      });
    }
    
    // Emails des contacts
    if (selectedQuote?.client_contacts && Array.isArray(selectedQuote.client_contacts)) {
      selectedQuote.client_contacts.forEach(contact => {
        if (contact.email) {
          emails.push({
            value: contact.email,
            label: `${contact.name}${contact.position ? ` - ${contact.position}` : ''} (${contact.email})`,
            type: 'contact'
          });
        }
      });
    }
    
    return emails;
  };

  // Fonctions pour gérer les lignes de devis
  const addQuoteItem = () => {
    setQuoteItems([...quoteItems, {
      product_id: '',
      product_name: '',
      product_description: '',
      quantity: 1,
      unit_price: 0,
      vat_rate: 20,
      discount_percent: 0,
      product_currency_id: null,
      exchange_rate: 1.0
    }]);
  };

  const removeQuoteItem = (index) => {
    setQuoteItems(quoteItems.filter((_, i) => i !== index));
  };

  const updateQuoteItem = (index, field, value) => {
    const newItems = [...quoteItems];
    newItems[index] = { ...newItems[index], [field]: value };
    
    // Si un produit est sélectionné, charger ses informations
    if (field === 'product_id' && value) {
      const product = products.find(p => p.id === parseInt(value));
      if (product) {
        newItems[index].product_name = product.name;
        newItems[index].product_description = product.description || '';
        newItems[index].unit_price = parseFloat(product.price_ht) || 0;
        // Important: si le taux TVA est 0 (ex: 0.00), ne pas retomber sur 20 (0 est falsy)
        const parsedVatRate = parseFloat(product.vat_rate);
        newItems[index].vat_rate = Number.isFinite(parsedVatRate) ? parsedVatRate : 20;
        newItems[index].product_currency_id = product.currency_id || null;
        
        // Si la devise du produit est différente de la devise du devis, initialiser le taux de change à 1.0
        if (product.currency_id && product.currency_id !== parseInt(formData.currency_id)) {
          newItems[index].exchange_rate = newItems[index].exchange_rate || 1.0;
        } else {
          newItems[index].exchange_rate = 1.0;
        }
      }
    }
    
    setQuoteItems(newItems);
  };

  // Calculer les totaux : unit_price est TOUJOURS en devise produit ; on convertit une seule fois en devise du devis
  // En mode HT : on n'utilise pas la TVA (tva = 0)
  const calculateTotals = () => {
    let totalHTAvantRemise = 0;
    let totalHTApresRemise = 0;
    const vatDetails = {};
    const isModeHT = formData.mode_calcul === 'ht';
    
    quoteItems.forEach(item => {
      const qty = parseFloat(item.quantity) || 0;
      const unitPriceProduct = parseFloat(item.unit_price) || 0;
      const discount = parseFloat(item.discount_percent) || 0;
      const tva = isModeHT ? 0 : (parseFloat(item.vat_rate) || 0);
      const exchangeRate = parseFloat(item.exchange_rate) || 1.0;
      
      // Une seule conversion : devise produit → devise du devis
      const prixHTQuote = unitPriceProduct * exchangeRate;
      
      const totalLigneAvantRemise = qty * prixHTQuote;
      const montantRemise = (totalLigneAvantRemise * discount) / 100;
      const totalLigneHT = totalLigneAvantRemise - montantRemise;
      const montantTVA = isModeHT ? 0 : (totalLigneHT * tva) / 100;
      
      totalHTAvantRemise += totalLigneAvantRemise;
      totalHTApresRemise += totalLigneHT;
      
      if (!isModeHT && tva > 0) {
        const vatKey = `${tva}%`;
        if (!vatDetails[vatKey]) {
          vatDetails[vatKey] = { rate: tva, amount: 0 };
        }
        vatDetails[vatKey].amount += montantTVA;
      }
    });
    
    // Appliquer la remise globale
    const remiseGlobale = parseFloat(formData.global_discount_percent) || 0;
    const totalHTAvantRemiseGlobale = totalHTApresRemise; // HT après remises ligne, avant remise globale
    const montantRemiseGlobale = (totalHTApresRemise * remiseGlobale) / 100;
    totalHTApresRemise = totalHTApresRemise - montantRemiseGlobale;
    
    const totalTVA = Object.values(vatDetails).reduce((sum, vat) => sum + vat.amount, 0);
    const totalTTC = totalHTApresRemise + totalTVA;
    
    return {
      totalHTAvantRemise,
      totalHTApresRemise,
      totalHTAvantRemiseGlobale,
      montantRemiseGlobale,
      vatDetails,
      totalTVA,
      totalTTC
    };
  };

  const totals = calculateTotals();

  // Symbole de la devise du devis (pour afficher tous les totaux dans cette devise)
  const quoteCurrency = formData.currency_id ? currencies.find(c => c.id === parseInt(formData.currency_id)) : null;
  const quoteCurrencySymbol = quoteCurrency?.symbol ?? '€';

  // Page de détail du devis
  if (showDetailPage && selectedQuote) {
    const statusLabels = {
      'pending': 'En attente',
      'created': 'Créé',
      'sent': 'Envoyé',
      'accepted': 'Accepté',
      'rejected': 'Refusé'
    };

    return (
      <div className="p-8">
        {/* Notification */}
        {notification && (
          <div className={`fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg max-w-md ${
            notification.type === 'success' 
              ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800' 
              : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
          }`}>
            <div className="flex items-start gap-3">
              <div className={`flex-shrink-0 text-xl ${
                notification.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
              }`}>
                {notification.type === 'success' ? '✅' : '❌'}
              </div>
              <div className="flex-1">
                <p className={`font-medium ${
                  notification.type === 'success' 
                    ? 'text-green-800 dark:text-green-200' 
                    : 'text-red-800 dark:text-red-200'
                }`}>
                  {notification.message}
                </p>
              </div>
              <button
                onClick={() => setNotification(null)}
                className={`flex-shrink-0 ${
                  notification.type === 'success' 
                    ? 'text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-200' 
                    : 'text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200'
                }`}
              >
                ✕
              </button>
            </div>
          </div>
        )}
        
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => {
                setShowDetailPage(false);
                setSelectedQuote(null);
              }}
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-2xl"
            >
              ←
            </button>
            <div>
              <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
                Devis {selectedQuote.quote_number}
              </h2>
              <p className="text-gray-500 dark:text-gray-400 mt-1">Détails du devis</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handlePrintPDF}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium flex items-center gap-2"
            >
              <span>🖨️</span>
              Imprimer PDF
            </button>
            {user?.role && user.role.toLowerCase() !== 'lecteur' && (
              <>
            <button
              onClick={() => {
                // Pré-sélectionner l'email du client s'il existe, sinon passer en mode manuel
                const availableEmails = getAvailableEmails();
                if (availableEmails.length > 0) {
                      setRecipientEmails([availableEmails[0].value]);
                  setEmailInputMode('select');
                } else {
                      setRecipientEmails([]);
                  setEmailInputMode('manual');
                }
                setShowEmailModal(true);
              }}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium flex items-center gap-2"
            >
              <span>📧</span>
              Envoyer par email
            </button>
            <button
              onClick={() => handleEditQuote(selectedQuote.id)}
              className="px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200 font-medium flex items-center gap-2"
            >
              <span>✏️</span>
              Modifier
            </button>
              </>
            )}
          </div>
        </div>

        {/* Détail visible du devis (écran) */}
        <div className="bg-white dark:bg-gray-900 p-8 rounded-lg mb-6">
          <div className="mb-6 pb-4 border-b-2 border-gray-300">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
              Devis {selectedQuote.quote_number}
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              Date: {selectedQuote.date ? new Date(selectedQuote.date).toLocaleDateString() : '-'}
            </p>
          </div>
          
          {/* Informations générales */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Informations générales
            </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
                <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Client
                </label>
                <p className="text-gray-900 dark:text-white">
                  {selectedQuote.client_name || '-'}
                </p>
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Devise
                </label>
              <p className="text-gray-900 dark:text-white">
                  {selectedQuote.currency_code
                    ? `${selectedQuote.currency_code} (${selectedQuote.currency_symbol})`
                    : '-'}
              </p>
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Statut
                </label>
              <span className="inline-flex px-2 py-1 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200">
                {statusLabels[selectedQuote.status] || selectedQuote.status}
              </span>
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Date
                </label>
              <p className="text-gray-900 dark:text-white">
                {selectedQuote.date ? new Date(selectedQuote.date).toLocaleDateString() : '-'}
              </p>
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Valide jusqu'au
                </label>
              <p className="text-gray-900 dark:text-white">
                  {selectedQuote.valid_until
                    ? new Date(selectedQuote.valid_until).toLocaleDateString()
                    : '-'}
              </p>
            </div>
              {selectedQuote.first_page_text && (
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Texte première page
                  </label>
                  <p className="text-gray-900 dark:text-white whitespace-pre-wrap">
                    {selectedQuote.first_page_text}
                  </p>
                </div>
              )}
              {selectedQuote.introduction_text && (
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Introduction
                  </label>
                  <p className="text-gray-900 dark:text-white whitespace-pre-wrap">
                    {selectedQuote.introduction_text}
                  </p>
                </div>
              )}
            {selectedQuote.conditions_generales && (
              <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Conditions Générales de Ventes
                  </label>
                  <p className="text-gray-900 dark:text-white whitespace-pre-wrap">
                    {selectedQuote.conditions_generales}
                  </p>
              </div>
            )}
          </div>
        </div>

        {/* Lignes du devis */}
        {selectedQuote.items && selectedQuote.items.length > 0 && (() => {
          const isDetailModeHT = selectedQuote.mode_calcul === 'ht';
          return (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Lignes du devis
              </h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-gray-200 dark:border-gray-700">
                  <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                        Produit
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                        Quantité
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                        Prix HT
                      </th>
                      {!isDetailModeHT && (
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                          TVA
                        </th>
                      )}
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                        Remise %
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                        Total HT
                      </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {selectedQuote.items.map((item, index) => {
                    const productForDesc = products.find((p) => p.id === Number(item.product_id));
                    const desc = productForDesc?.description || '';
                    return (
                    <tr key={index}>
                        <td className="px-4 py-3 text-gray-900 dark:text-white">
                          <div className="font-medium">{item.product_name || '-'}</div>
                          {desc && (
                            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap">
                              {desc}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                          {item.quantity}
                        </td>
                      <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300">
                          {Number(item.unit_price).toFixed(2)}{' '}
                          {selectedQuote.currency_symbol || '€'}
                      </td>
                        {!isDetailModeHT && (
                          <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                            {item.vat_rate}%
                          </td>
                        )}
                        <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300">
                          {item.discount_percent || 0}%
                        </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900 dark:text-white">
                          {Number(item.total_ht).toFixed(2)}{' '}
                          {selectedQuote.currency_symbol || '€'}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
        })()}

        {/* Totaux : en mode HT uniquement Total HT, pas de TVA ni TTC */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Totaux</h3>
          <div className="space-y-3">
            {selectedQuote.mode_calcul === 'ht' ? (
              (() => {
                const totalHT = Number(selectedQuote.total_ht || 0);
                const remisePct = parseFloat(selectedQuote.global_discount_percent) || 0;
                const symbol = selectedQuote.currency_symbol || '€';
                const hasRemise = remisePct > 0;
                const totalHTAvantRemiseGlobale = hasRemise ? totalHT / (1 - remisePct / 100) : totalHT;
                const montantRemiseGlobale = hasRemise ? totalHTAvantRemiseGlobale * (remisePct / 100) : 0;
                return (
                  <>
                    {hasRemise ? (
                      <>
                        <div className="flex justify-between text-gray-700 dark:text-gray-300">
                          <span>Total HT avant remise</span>
                          <span>{totalHTAvantRemiseGlobale.toFixed(2)} {symbol}</span>
                        </div>
                        <div className="flex justify-between text-gray-700 dark:text-gray-300">
                          <span>Remise globale ({remisePct}%)</span>
                          <span>- {montantRemiseGlobale.toFixed(2)} {symbol}</span>
                        </div>
                        <div className="flex justify-between text-2xl font-bold text-gray-900 dark:text-white pt-2 border-t-2 border-gray-300 dark:border-gray-600">
                          <span>Total HT après remise</span>
                          <span>{totalHT.toFixed(2)} {symbol}</span>
                        </div>
                      </>
                    ) : (
                      <div className="flex justify-between text-2xl font-bold text-gray-900 dark:text-white">
                        <span>Total HT</span>
                        <span>{totalHT.toFixed(2)} {symbol}</span>
                      </div>
                    )}
                  </>
                );
              })()
            ) : (
              <>
                <div className="flex justify-between text-gray-700 dark:text-gray-300">
                  <span>Total HT après remise</span>
                  <span>
                    {Number(selectedQuote.total_ht || 0).toFixed(2)}{' '}
                    {selectedQuote.currency_symbol || '€'}
                  </span>
                </div>
                {selectedQuote.global_discount_percent > 0 && (
                  <div className="flex justify-between text-gray-600 dark:text-gray-400 text-sm">
                    <span>Remise globale ({selectedQuote.global_discount_percent}%)</span>
                    <span>-</span>
                  </div>
                )}
                <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
                  <div className="flex justify-between font-semibold text-gray-700 dark:text-gray-300">
                    <span>Total TVA</span>
                    <span>
                      {Number(selectedQuote.total_vat || 0).toFixed(2)}{' '}
                      {selectedQuote.currency_symbol || '€'}
                    </span>
                  </div>
                </div>
                <div className="flex justify-between text-2xl font-bold text-gray-900 dark:text-white pt-3 border-t-2 border-gray-300 dark:border-gray-600">
                  <span>Total TTC</span>
                  <span>
                    {Number(selectedQuote.total_ttc || 0).toFixed(2)}{' '}
                    {selectedQuote.currency_symbol || '€'}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
        </div>

        {/* Version spéciale impression PDF, rendue hors écran */}
        <div
          ref={quoteRef}
          className="bg-white p-8"
          style={{ position: 'absolute', left: '-99999px', top: 0 }}
          aria-hidden="true"
        >
          {(() => {
            const quoteDate =
              selectedQuote.date ? new Date(selectedQuote.date).toLocaleDateString() : '-';

            const baseUploadsUrl = API_URL.replace('/api', '');

            const companyLogoUrl = (() => {
              if (layoutConfig.logo_url) return layoutConfig.logo_url;
              if (layoutConfig.logo_file_path) {
                const relativePath = layoutConfig.logo_file_path.replace(/^uploads[\\/]/, '');
                return `${baseUploadsUrl}/uploads/${relativePath}`;
              }
              return null;
            })();

            const clientForQuote = printClient;

            const clientLogoUrl = (() => {
              if (!clientForQuote) return null;
              if (clientForQuote.logo_url) return clientForQuote.logo_url;
              if (clientForQuote.logo_file_path) {
                const relativePath = clientForQuote.logo_file_path.replace(/^uploads[\\/]/, '');
                return `${baseUploadsUrl}/uploads/${relativePath}`;
              }
              return null;
            })();

            const pdfLogoDisplay = getPdfLogoDisplay(companyLogoUrl, clientLogoUrl);
            const LOGO_MAX_HEIGHT_PX = 60;

            const currentUser = userWithSignature || user;
            const signatureImageUrl = (() => {
              if (currentUser?.signature_link) {
                return currentUser.signature_link;
              }
              if (currentUser?.signature_file_path) {
                const relativePath = currentUser.signature_file_path.replace(/^uploads[\\/]/, '');
                return `${baseUploadsUrl}/uploads/${relativePath}`;
              }
              return null;
            })();

            const hasFooter =
              layoutConfig.footer_text && layoutConfig.footer_text.trim() !== '';

            const totalPages = 2;
            const pageHeight = 1123; // Hauteur A4 en pixels (297mm à 96dpi)
            const marginTop = 50;
            const marginBottom = 90;
            const marginLeft = 45;
            const marginRight = 45;
            const footerHeight = 80;
            const contentHeight = pageHeight - marginTop - marginBottom;

            const Footer = ({ pageNum }) => (
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: `${footerHeight}px`,
                  backgroundColor: '#ffffff',
                  color: '#333333',
                  borderTop: '1px solid #e0e0e0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12px',
                  padding: '20px 0',
                  zIndex: 10
                }}
              >
                {hasFooter ? (
                  <div className="text-center whitespace-pre-wrap" style={{ color: '#333333' }}>
                    {layoutConfig.footer_text}
                  </div>
                ) : (
                  <div className="text-center" style={{ color: '#333333' }}>
                    Centre urbain Nord, Sana Center, bloc C — 1082, Tunis
                  </div>
                )}
              </div>
            );

            return (
              <>
                {/* Première page */}
                <div
                  ref={page1Ref}
                  style={{
                    width: '794px',
                    height: `${pageHeight}px`,
                    position: 'relative',
                    backgroundColor: '#ffffff',
                    paddingTop: `${marginTop}px`,
                    paddingBottom: `${marginBottom}px`,
                    paddingLeft: `${marginLeft}px`,
                    paddingRight: `${marginRight}px`,
                    pageBreakAfter: 'always',
                    overflow: 'hidden',
                    boxSizing: 'border-box'
                  }}
                >
                  {/* Contenu principal */}
                  <div
                    style={{
                      height: `${contentHeight}px`,
                      overflow: 'hidden',
                      paddingBottom: `${footerHeight}px`
                    }}
                  >
                    {/* En-tête avec logos : affiché uniquement si logo entreprise présent ; client à gauche, entreprise à droite si les deux ; sinon entreprise centrée */}
                    {pdfLogoDisplay.showLogoHeader && (
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: pdfLogoDisplay.companyCenteredOnly ? 'center' : 'space-between',
                          alignItems: 'center',
                          marginBottom: '40px',
                          minHeight: `${LOGO_MAX_HEIGHT_PX}px`
                        }}
                      >
                        {pdfLogoDisplay.bothLogos ? (
                          <>
                            <div style={{ maxHeight: `${LOGO_MAX_HEIGHT_PX}px`, display: 'flex', alignItems: 'center' }}>
                              <PdfLogoImage
                                src={pdfLogoDisplay.clientLogoUrl}
                                alt="Logo client"
                                style={{ maxHeight: `${LOGO_MAX_HEIGHT_PX}px`, width: 'auto', objectFit: 'contain' }}
                              />
                            </div>
                            <div style={{ maxHeight: `${LOGO_MAX_HEIGHT_PX}px`, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                              <PdfLogoImage
                                src={pdfLogoDisplay.companyLogoUrl}
                                alt="Logo entreprise"
                                style={{ maxHeight: `${LOGO_MAX_HEIGHT_PX}px`, width: 'auto', objectFit: 'contain' }}
                              />
                            </div>
                          </>
                        ) : (
                          <div style={{ maxHeight: `${LOGO_MAX_HEIGHT_PX}px`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <PdfLogoImage
                              src={pdfLogoDisplay.companyLogoUrl}
                              alt="Logo entreprise"
                              style={{ maxHeight: `${LOGO_MAX_HEIGHT_PX}px`, width: 'auto', objectFit: 'contain' }}
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Date */}
                    <p style={{ textAlign: 'right', fontSize: '14px', color: '#4b5563', marginBottom: '0px' }}>
                      Tunis, le {quoteDate}
                    </p>
                    
                    {/* Client */}
                    <div style={{ marginBottom: '30px', fontSize: '14px', color: '#4b5563' }}>
                      <p style={{ textAlign: 'left' }}>
                        <span style={{ textDecoration: 'underline', fontWeight: '600' }}>Client :</span>{' '}
                        <span style={{ fontWeight: '600', color: '#1f2937' }}>
                          {selectedQuote.client_name || '-'}
                        </span>
                      </p>
                    </div>

                    {/* Titre principal */}
                    <h1 style={{
                      textAlign: 'center',
                      fontSize: '36px',
                      fontWeight: 'bold',
                      color: '#111827',
                      letterSpacing: '0.05em',
                      marginTop: '0px',
                      marginBottom: '35px'
                    }}>
                      OFFRE COMMERCIALE
                    </h1>
                    <p style={{ textAlign: 'center', fontSize: '12px', color: '#374151', marginBottom: '25px' }}>
                      NUMÉRO : {selectedQuote.quote_number || '-'}
                    </p>

                    {/* Texte première page - COMPLET, ne pas couper */}
                    {selectedQuote.first_page_text && (
                      <div style={{
                        maxWidth: '600px',
                        margin: '0 auto 40px auto',
                        textAlign: 'center'
                      }}>
                        <p style={{
                          fontSize: '14px',
                          color: '#1f2937',
                          whiteSpace: 'pre-wrap',
                          lineHeight: '1.6'
                        }}>
                          {selectedQuote.first_page_text}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Footer fixe */}
                  <Footer pageNum={1} />
                </div>

                {/* Deuxième page */}
                <div
                  ref={page2Ref}
                  style={{
                    width: '794px',
                    height: `${pageHeight}px`,
                    position: 'relative',
                    backgroundColor: '#ffffff',
                    paddingTop: `${marginTop}px`,
                    paddingBottom: `${marginBottom}px`,
                    paddingLeft: `${marginLeft}px`,
                    paddingRight: `${marginRight}px`,
                    pageBreakBefore: 'always',
                    overflow: 'hidden',
                    boxSizing: 'border-box'
                  }}
                >
                  {/* Contenu principal */}
                  <div
                    style={{
                      height: `${contentHeight}px`,
                      overflow: 'auto',
                      paddingBottom: `${footerHeight}px`
                    }}
                  >
                    {/* Date */}
                    <p style={{ textAlign: 'right', fontSize: '14px', color: '#4b5563', marginTop: '0px', marginBottom: '40px' }}>
                      Tunis, le {quoteDate}
                    </p>

                    {/* Introduction - Section complète, ne pas couper */}
                    {selectedQuote.introduction_text && (
                      <div style={{
                        marginBottom: '35px',
                        textAlign: 'left',
                        pageBreakInside: 'avoid'
                      }}>
                        <h2 style={{
                          fontSize: '16px',
                          fontWeight: '600',
                          color: '#111827',
                          marginTop: '0px',
                          marginBottom: '25px'
                        }}>
                          Introduction
                        </h2>
                        <p style={{
                          fontSize: '14px',
                          color: '#1f2937',
                          whiteSpace: 'pre-wrap',
                          lineHeight: '1.6',
                          marginBottom: '0px'
                        }}>
                          {selectedQuote.introduction_text}
                        </p>
                      </div>
                    )}

                    {/* Lignes du devis - Tableau complet (PDF) */}
                    {selectedQuote.items && selectedQuote.items.length > 0 && (() => {
                      const isPdfModeHT = selectedQuote.mode_calcul === 'ht';
                      const hasLineDiscount = selectedQuote.items.some(item => (parseFloat(item.discount_percent) || 0) > 0);
                      return (
                      <div style={{ marginTop: '30px', marginBottom: '35px', pageBreakInside: 'avoid' }}>
                        <table style={{
                          width: '100%',
                          fontSize: '12px',
                          marginBottom: '16px',
                          borderCollapse: 'collapse'
                        }}>
                          <thead style={{ borderBottom: '1px solid #e5e7eb' }}>
                            <tr>
                              <th style={{ padding: '8px', textAlign: 'left', fontSize: '12px', fontWeight: '500', color: '#6b7280', textTransform: 'uppercase' }}>
                                Produit
                              </th>
                              <th style={{ padding: '8px', textAlign: 'left', fontSize: '12px', fontWeight: '500', color: '#6b7280', textTransform: 'uppercase' }}>
                                Quantité
                              </th>
                              <th style={{ padding: '8px', textAlign: 'right', fontSize: '12px', fontWeight: '500', color: '#6b7280', textTransform: 'uppercase' }}>
                                Prix HT
                              </th>
                              {!isPdfModeHT && (
                                <th style={{ padding: '8px', textAlign: 'left', fontSize: '12px', fontWeight: '500', color: '#6b7280', textTransform: 'uppercase' }}>
                                  TVA
                                </th>
                              )}
                              {hasLineDiscount && (
                                <th style={{ padding: '8px', textAlign: 'right', fontSize: '12px', fontWeight: '500', color: '#6b7280', textTransform: 'uppercase' }}>
                                  Remise %
                                </th>
                              )}
                              <th style={{ padding: '8px', textAlign: 'right', fontSize: '12px', fontWeight: '500', color: '#6b7280', textTransform: 'uppercase' }}>
                                Total HT
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedQuote.items.map((item, index) => (
                              <tr key={index} style={{ borderBottom: '1px solid #e5e7eb' }}>
                                <td style={{ padding: '8px', color: '#111827', fontSize: '12px' }}>
                                  <div style={{ fontWeight: 600 }}>
                                    {item.product_name || '-'}
                                  </div>
                                  {(() => {
                                    const desc =
                                      products.find((p) => p.id === Number(item.product_id))?.description || '';
                                    return desc ? (
                                      <div
                                        style={{
                                          marginTop: '4px',
                                          fontSize: '10px',
                                          color: '#6b7280',
                                          whiteSpace: 'pre-wrap',
                                          lineHeight: '1.4'
                                        }}
                                      >
                                        {desc}
                                      </div>
                                    ) : null;
                                  })()}
                                </td>
                                <td style={{ padding: '8px', color: '#374151', fontSize: '12px' }}>
                                  {item.quantity}
                                </td>
                                <td style={{ padding: '8px', textAlign: 'right', color: '#374151', fontSize: '12px' }}>
                                  {Number(item.unit_price).toFixed(2)}{' '}
                                  {selectedQuote.currency_symbol || '€'}
                                </td>
                                {!isPdfModeHT && (
                                  <td style={{ padding: '8px', color: '#374151', fontSize: '12px' }}>
                                    {item.vat_rate}%
                                  </td>
                                )}
                                {hasLineDiscount && (
                                  <td style={{ padding: '8px', textAlign: 'right', color: '#374151', fontSize: '12px' }}>
                                    {item.discount_percent || 0}%
                                  </td>
                                )}
                                <td style={{ padding: '8px', textAlign: 'right', fontWeight: '600', color: '#111827', fontSize: '12px' }}>
                                  {Number(item.total_ht).toFixed(2)}{' '}
                                  {selectedQuote.currency_symbol || '€'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        
                        {/* Totaux : en mode HT uniquement Total HT ; avec remise : montant + % + Total HT après remise */}
                        <div style={{ textAlign: 'right', fontSize: '12px' }}>
                          {isPdfModeHT && (parseFloat(selectedQuote.global_discount_percent) || 0) > 0 ? (() => {
                            const totalHT = Number(selectedQuote.total_ht || 0);
                            const remisePct = parseFloat(selectedQuote.global_discount_percent) || 0;
                            const symbol = selectedQuote.currency_symbol || '€';
                            const totalHTAvantRemiseGlobale = totalHT / (1 - remisePct / 100);
                            const montantRemiseGlobale = totalHTAvantRemiseGlobale * (remisePct / 100);
                            return (
                              <>
                                <div style={{ marginBottom: '4px' }}>
                                  <span style={{ color: '#374151' }}>Total HT avant remise</span>
                                  <span style={{ marginLeft: '16px', fontWeight: '600', color: '#111827' }}>
                                    {totalHTAvantRemiseGlobale.toFixed(2)} {symbol}
                                  </span>
                                </div>
                                <div style={{ marginBottom: '4px' }}>
                                  <span style={{ color: '#374151' }}>Remise globale ({remisePct}%)</span>
                                  <span style={{ marginLeft: '16px', fontWeight: '600', color: '#111827' }}>
                                    - {montantRemiseGlobale.toFixed(2)} {symbol}
                                  </span>
                                </div>
                                <div style={{ marginBottom: '4px', marginTop: '8px', fontWeight: 'bold', fontSize: '14px' }}>
                                  <span style={{ color: '#374151' }}>Total HT après remise</span>
                                  <span style={{ marginLeft: '16px', color: '#111827' }}>
                                    {totalHT.toFixed(2)} {symbol}
                                  </span>
                                </div>
                              </>
                            );
                          })() : isPdfModeHT ? (
                            <div style={{ marginBottom: '4px' }}>
                              <span style={{ color: '#374151' }}>Total HT</span>
                              <span style={{ marginLeft: '16px', fontWeight: '600', color: '#111827' }}>
                                {Number(selectedQuote.total_ht || 0).toFixed(2)}{' '}
                                {selectedQuote.currency_symbol || '€'}
                              </span>
                            </div>
                          ) : null}
                          {!isPdfModeHT && (
                            <>
                              <div style={{ marginBottom: '4px' }}>
                                <span style={{ color: '#374151' }}>Total HT</span>
                                <span style={{ marginLeft: '16px', fontWeight: '600', color: '#111827' }}>
                                  {Number(selectedQuote.total_ht || 0).toFixed(2)}{' '}
                                  {selectedQuote.currency_symbol || '€'}
                                </span>
                              </div>
                              <div style={{ marginBottom: '4px' }}>
                                <span style={{ color: '#374151' }}>Total TVA</span>
                                <span style={{ marginLeft: '16px', fontWeight: '600', color: '#111827' }}>
                                  {Number(selectedQuote.total_vat || 0).toFixed(2)}{' '}
                                  {selectedQuote.currency_symbol || '€'}
                                </span>
                              </div>
                              <div>
                                <span style={{ color: '#374151' }}>Total TTC</span>
                                <span style={{ marginLeft: '16px', fontSize: '14px', fontWeight: 'bold', color: '#111827' }}>
                                  {Number(selectedQuote.total_ttc || 0).toFixed(2)}{' '}
                                  {selectedQuote.currency_symbol || '€'}
                                </span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    );
                    })()}

                    {/* Conditions Générales de Ventes */}
                    {selectedQuote.conditions_generales && (
                      <div style={{ marginTop: '35px', marginBottom: '30px', pageBreakInside: 'avoid' }}>
                        <h3 style={{
                          fontSize: '16px',
                          fontWeight: '600',
                          color: '#111827',
                          marginTop: '0px',
                          marginBottom: '20px'
                        }}>
                          Conditions Générales de Ventes
                        </h3>
                        <p style={{
                          fontSize: '14px',
                          color: '#1f2937',
                          whiteSpace: 'pre-wrap',
                          lineHeight: '1.6',
                          marginBottom: '0px'
                        }}>
                          {selectedQuote.conditions_generales}
                        </p>
                      </div>
                    )}

                    {/* Validité de l'offre */}
                    {selectedQuote.valid_until && (
                      <div style={{ marginBottom: '25px' }}>
                        <p style={{ fontSize: '14px', color: '#1f2937', marginTop: '0px', marginBottom: '0px' }}>
                          Offre valable jusqu'au {new Date(selectedQuote.valid_until).toLocaleDateString()}
                        </p>
                      </div>
                    )}

                    {/* Signature */}
                    {(currentUser?.signature_text || signatureImageUrl) && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0px', marginBottom: '40px' }}>
                        <div style={{ textAlign: 'right' }}>
                          {currentUser?.signature_text && (
                            <p style={{
                              fontSize: '14px',
                              color: '#374151',
                              marginTop: '0px',
                              marginBottom: '8px',
                              whiteSpace: 'pre-wrap'
                            }}>
                              {currentUser.signature_text}
                            </p>
                          )}
                          {signatureImageUrl && (
                            <img
                              src={signatureImageUrl}
                              alt="Signature"
                              crossOrigin="anonymous"
                              style={{ maxHeight: '96px', objectFit: 'contain', display: 'inline-block' }}
                            />
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Footer fixe */}
                  <Footer pageNum={2} />
                </div>
              </>
            );
          })()}
        </div>

        {/* Pièces jointes - En dehors de quoteRef pour ne pas apparaître dans le PDF */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Pièces jointes</h3>
            <button
              onClick={() => setShowAttachmentModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium flex items-center gap-2"
            >
              <span>📎</span>
              Ajouter une pièce jointe
            </button>
          </div>
          
          {attachments.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 text-center py-8">
              Aucune pièce jointe. Cliquez sur "Ajouter une pièce jointe" pour en ajouter.
            </p>
          ) : (
            <div className="space-y-2">
              {attachments.map((attachment) => (
                <div key={attachment.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <div className="flex items-center gap-3 flex-1">
                    <span className="text-2xl">📄</span>
                    <div className="flex-1">
                      <p className="text-gray-900 dark:text-white font-medium">{attachment.original_filename}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {(attachment.file_size / 1024).toFixed(2)} KB - 
                        {attachment.created_at ? new Date(attachment.created_at).toLocaleDateString() : '-'}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleViewAttachment(attachment)}
                      className="px-3 py-1 text-green-600 hover:text-green-800 dark:text-green-400 text-sm"
                      title="Voir"
                    >
                      👁️
                    </button>
                    <button
                      onClick={() => handleDownloadAttachment(attachment.id)}
                      className="px-3 py-1 text-blue-600 hover:text-blue-800 dark:text-blue-400 text-sm"
                      title="Télécharger"
                    >
                      ⬇️
                    </button>
                    <button
                      onClick={() => handleDeleteAttachment(attachment.id)}
                      className="px-3 py-1 text-red-600 hover:text-red-800 dark:text-red-400 text-sm"
                      title="Supprimer"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Modal Visualisation Pièce Jointe */}
        {showViewAttachmentModal && viewingAttachment && (
          <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
              <div className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                  {viewingAttachment.original_filename}
                </h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDownloadAttachment(viewingAttachment.id)}
                    className="px-3 py-1 text-blue-600 hover:text-blue-800 dark:text-blue-400 text-sm"
                    title="Télécharger"
                  >
                    ⬇️ Télécharger
                  </button>
                  <button
                    onClick={() => {
                      setShowViewAttachmentModal(false);
                      setViewingAttachment(null);
                    }}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-4">
                {isImageFile(viewingAttachment.mime_type) ? (
                  <div className="flex justify-center">
                    <img
                      src={getAttachmentViewUrl(viewingAttachment.id)}
                      alt={viewingAttachment.original_filename}
                      className="max-w-full max-h-[70vh] object-contain"
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.nextSibling.style.display = 'block';
                      }}
                    />
                    <div style={{ display: 'none' }} className="text-center text-gray-500 dark:text-gray-400">
                      <p>Impossible de charger l'image</p>
                      <button
                        onClick={() => handleDownloadAttachment(viewingAttachment.id)}
                        className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                      >
                        Télécharger le fichier
                      </button>
                    </div>
                  </div>
                ) : isPdfFile(viewingAttachment.mime_type) ? (
                  <div className="w-full h-full">
                    <iframe
                      src={getAttachmentViewUrl(viewingAttachment.id)}
                      className="w-full h-[70vh] border-0"
                      title={viewingAttachment.original_filename}
                    />
                  </div>
                ) : isTextFile(viewingAttachment.mime_type) ? (
                  <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg">
                    <iframe
                      src={getAttachmentViewUrl(viewingAttachment.id)}
                      className="w-full h-[70vh] border-0"
                      title={viewingAttachment.original_filename}
                    />
                  </div>
                ) : (
                  <div className="text-center py-16">
                    <div className="text-6xl mb-4">📄</div>
                    <p className="text-gray-500 dark:text-gray-400 mb-4">
                      Aperçu non disponible pour ce type de fichier
                    </p>
                    <p className="text-sm text-gray-400 dark:text-gray-500 mb-4">
                      Type: {viewingAttachment.mime_type || 'Inconnu'}
                    </p>
                    <button
                      onClick={() => handleDownloadAttachment(viewingAttachment.id)}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      ⬇️ Télécharger le fichier
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Modal Upload Pièces Jointes */}
        {showAttachmentModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">Ajouter des pièces jointes</h3>
                <button
                  onClick={() => setShowAttachmentModal(false)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl"
                >
                  ✕
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Sélectionner les fichiers (max 10MB par fichier)
                  </label>
                  <input
                    type="file"
                    multiple
                    onChange={handleUploadAttachments}
                    disabled={uploadingFiles}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white disabled:opacity-50"
                  />
                  {uploadingFiles && (
                    <p className="text-sm text-blue-600 dark:text-blue-400 mt-2">Upload en cours...</p>
                  )}
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowAttachmentModal(false)}
                    disabled={uploadingFiles}
                    className="px-4 py-2 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                  >
                    Fermer
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Section Commentaires */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Commentaires</h3>
            <button
              onClick={() => {
                setCommentText('');
                setAssignedToUserId('');
                setShowCommentModal(true);
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium flex items-center gap-2"
            >
              <span>💬</span>
              Ajouter un commentaire
            </button>
          </div>
          
          {comments.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 text-center py-8">
              Aucun commentaire. Cliquez sur "Ajouter un commentaire" pour en ajouter un.
            </p>
          ) : (
            <div className="space-y-4">
              {comments.map((comment) => (
                <div key={comment.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">
                        {comment.user_name || 'Utilisateur'}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {comment.created_at ? new Date(comment.created_at).toLocaleString('fr-FR') : '-'}
                      </p>
                    </div>
                    {comment.assigned_to_name && (
                      <span className="inline-flex px-2 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200">
                        Assigné à: {comment.assigned_to_name}
                      </span>
                    )}
                  </div>
                  <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{comment.comment}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Modal Ajout Commentaire */}
        {showCommentModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">Ajouter un commentaire</h3>
                <button
                  onClick={() => {
                    setShowCommentModal(false);
                    setCommentText('');
                    setAssignedToUserId('');
                  }}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl"
                >
                  ✕
                </button>
              </div>
              <form onSubmit={handleCreateComment}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Commentaire *
                  </label>
                    <textarea
                      required
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      rows={4}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                      placeholder="Saisissez votre commentaire..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Assigner à (optionnel)
                    </label>
                      <select
                      value={assignedToUserId}
                      onChange={(e) => setAssignedToUserId(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                      >
                      <option value="">-- Aucune assignation --</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.email})
                          </option>
                        ))}
                      </select>
                    {assignedToUserId && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        L'utilisateur recevra une notification par email et dans l'application
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex justify-end gap-3 mt-6">
                          <button
                            type="button"
                            onClick={() => {
                      setShowCommentModal(false);
                      setCommentText('');
                      setAssignedToUserId('');
                    }}
                    className="px-4 py-2 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    Annuler
                          </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                  >
                    Ajouter
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal Envoi Email */}
        {showEmailModal && user?.role && user.role.toLowerCase() !== 'lecteur' && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">Envoyer le devis par email</h3>
                <button
                  onClick={() => {
                    setShowEmailModal(false);
                    setRecipientEmails([]);
                    setManualEmailInput('');
                    setEmailMessage('');
                    setEmailInputMode('select');
                  }}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl"
                >
                  ✕
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Destinataires *
                  </label>
                  <div className="space-y-2">
                    {/* Sélection multiple parmi les emails connus */}
                    {getAvailableEmails().length > 0 && (
                      <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                          Emails liés au client
                        </label>
                        <div className="space-y-1">
                          {getAvailableEmails().map((email, index) => {
                            const isSelected = recipientEmails.includes(email.value);
                            return (
                              <label
                                key={index}
                                className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"
                              >
                                <input
                                  type="checkbox"
                                  className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                                  checked={isSelected}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setRecipientEmails((prev) =>
                                        prev.includes(email.value)
                                          ? prev
                                          : [...prev, email.value]
                                      );
                                    } else {
                                      setRecipientEmails((prev) =>
                                        prev.filter((v) => v !== email.value)
                                      );
                                    }
                                  }}
                                />
                                <span>{email.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Saisie manuelle (plusieurs emails séparés par ; ou ,) */}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 mt-2">
                        Autres destinataires (séparés par ; ou ,)
                      </label>
                      <textarea
                        value={manualEmailInput}
                        onChange={(e) => {
                          setManualEmailInput(e.target.value);
                          const raw = e.target.value
                            .split(/[;,]/)
                            .map((s) => s.trim())
                            .filter((s) => s.length > 0);
                          setRecipientEmails((prev) => {
                            // Conserver les emails déjà cochés + emails manuels
                            const fromCheckbox = prev.filter((e) =>
                              getAvailableEmails().some((a) => a.value === e)
                            );
                            const merged = [...fromCheckbox, ...raw];
                            return Array.from(new Set(merged));
                          });
                        }}
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-sm"
                        placeholder="email1@example.com; email2@example.com"
                      />
                  </div>

                    {/* Récap des destinataires sélectionnés */}
                    {recipientEmails.length > 0 && (
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        <span className="font-medium">Destinataires sélectionnés :</span>{' '}
                        {recipientEmails.join(', ')}
                      </div>
                  )}
                </div>
                </div>

                {/* Champ message personnalisé */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Message (optionnel)
                  </label>
                  <textarea
                    value={emailMessage}
                    onChange={(e) => setEmailMessage(e.target.value)}
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-sm"
                    placeholder="Votre message qui apparaîtra au début de l'email..."
                  />
                </div>

                {/* Information sur le CC utilisateur connecté */}
                {user && (
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    L'utilisateur connecté <span className="font-medium">{user.email}</span> sera mis en copie (CC).
                  </div>
                )}
                <div className="flex justify-end gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowEmailModal(false);
                      setRecipientEmails([]);
                      setManualEmailInput('');
                      setEmailMessage('');
                      setEmailInputMode('select');
                    }}
                    disabled={sendingEmail}
                    className="px-4 py-2 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={handleSendEmail}
                    disabled={sendingEmail}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium disabled:opacity-50"
                  >
                    {sendingEmail ? 'Envoi...' : 'Envoyer'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Page de création/modification
  if (showCreatePage || editingQuote) {
    return (
      <div className="p-8">
        <div className="mb-6 flex items-center gap-4">
          <button 
            onClick={() => {
              setShowCreatePage(false);
              setEditingQuote(null);
              resetForm();
            }}
            className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-2xl"
          >
            ←
          </button>
          <div>
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
              {editingQuote ? `Modifier le devis ${editingQuote.quote_number}` : 'Nouveau devis'}
            </h2>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              {editingQuote ? 'Modifiez les informations du devis' : 'Créez un nouveau devis pour un client'}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Informations générales */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Informations générales</h3>
            <div className="flex items-center gap-4 mb-4 pb-4 border-b border-gray-200 dark:border-gray-700">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Mode de calcul des prix :</span>
              <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600">
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, mode_calcul: 'ht' })}
                  className={`px-4 py-2 text-sm font-medium ${formData.mode_calcul === 'ht' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
                >
                  HT
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, mode_calcul: 'ttc' })}
                  className={`px-4 py-2 text-sm font-medium ${formData.mode_calcul === 'ttc' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
                >
                  TTC
                </button>
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {formData.mode_calcul === 'ht' ? 'Prix unitaires saisis en HT' : 'Prix unitaires saisis en TTC'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Numéro de devis
                </label>
                <input
                  type="text"
                  value={formData.quote_number || ''}
                  onChange={(e) => setFormData({ ...formData, quote_number: e.target.value })}
                  placeholder="Laisser vide pour générer automatiquement"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Client *
                </label>
                <select
                  required
                  value={formData.client_id}
                  onChange={(e) => setFormData({...formData, client_id: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                >
                  <option value="">Sélectionner un client</option>
                  {clients.map(client => (
                    <option key={client.id} value={client.id}>{client.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Devise du devis *
                </label>
                <select
                  required
                  value={formData.currency_id}
                  onChange={(e) => setFormData({...formData, currency_id: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                >
                  <option value="">Sélectionner...</option>
                  {currencies.map(currency => (
                    <option key={currency.id} value={currency.id}>
                      {currency.code} - {currency.name} ({currency.symbol})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Statut
                </label>
                <select
                  value={formData.status}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      status: e.target.value,
                      // Si aucune date n'a encore été saisie, garder la date initiale
                      // (date de création par défaut) plutôt que de forcer une nouvelle saisie.
                      date: prev.date || new Date().toISOString().split('T')[0],
                      valid_until:
                        prev.valid_until ||
                        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
                          .toISOString()
                          .split('T')[0]
                    }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                >
                  <option value="pending">En attente</option>
                  <option value="created">Créé</option>
                  <option value="sent">Envoyé</option>
                  <option value="accepted">Accepté</option>
                  <option value="rejected">Refusé</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Date *
                </label>
                <input
                  type="date"
                  required
                  value={formData.date}
                  onChange={(e) => setFormData({...formData, date: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Valide jusqu'au *
                </label>
                <input
                  type="date"
                  required
                  value={formData.valid_until}
                  onChange={(e) => setFormData({...formData, valid_until: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                />
              </div>
              <div></div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Texte première page
                </label>
                <textarea
                  value={formData.first_page_text}
                  onChange={(e) => setFormData({ ...formData, first_page_text: e.target.value })}
                  className="w-full px-3 py-2 mb-4 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="Texte qui apparaîtra sur la première page du devis..."
                  rows="3"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Introduction
                </label>
                <textarea
                  value={formData.introduction_text}
                  onChange={(e) => setFormData({ ...formData, introduction_text: e.target.value })}
                  className="w-full px-3 py-2 mb-4 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="Texte d'introduction qui sera affiché sous le texte de la première page..."
                  rows="3"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Conditions Générales de Ventes
                </label>
                <textarea
                  value={formData.conditions_generales}
                  onChange={(e) => setFormData({...formData, conditions_generales: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="Conditions générales de ventes..."
                  rows="4"
                />
              </div>
            </div>
          </div>

          {/* Lignes du devis */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Lignes du devis</h3>
              <button
                type="button"
                onClick={addQuoteItem}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium flex items-center gap-2"
              >
                <span>➕</span>
                Ajouter une ligne
              </button>
            </div>
            
            {quoteItems.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400 text-center py-8">
                Aucune ligne de devis. Cliquez sur "Ajouter une ligne" pour commencer.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-gray-200 dark:border-gray-700">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Produit</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Quantité</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{formData.mode_calcul === 'ttc' ? 'Prix TTC' : 'Prix HT'}</th>
                      {formData.mode_calcul === 'ttc' && (
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">TVA</th>
                      )}
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Remise %</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Total HT</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {quoteItems.map((item, index) => {
                      const qty = parseFloat(item.quantity) || 0;
                      const prixHT = parseFloat(item.unit_price) || 0;
                      const tvaRate = parseFloat(item.vat_rate) || 0;
                      const discount = parseFloat(item.discount_percent) || 0;
                      const exchangeRate = parseFloat(item.exchange_rate) || 1.0;
                      const isModeTTC = formData.mode_calcul === 'ttc';
                      // En mode TTC, unit_price est stocké en HT ; pour l'affichage on utilise TTC = HT * (1 + TVA/100)
                      const prixTTC = prixHT * (1 + tvaRate / 100);
                      
                      // Vérifier si la devise du produit est différente de la devise du devis
                      const productCurrencyId = item.product_currency_id;
                      const quoteCurrencyId = formData.currency_id ? parseInt(formData.currency_id) : null;
                      const needsConversion = productCurrencyId && quoteCurrencyId && productCurrencyId !== quoteCurrencyId;
                      
                      // Trouver les devises pour afficher leurs codes
                      const productCurrency = currencies.find(c => c.id === productCurrencyId);
                      const quoteCurrency = currencies.find(c => c.id === quoteCurrencyId);
                      
                      // Convertir le prix dans la devise du devis (toujours en HT pour le calcul)
                      const prixHTConverti = prixHT * exchangeRate;
                      const totalLigneAvantRemise = qty * prixHTConverti;
                      const montantRemise = (totalLigneAvantRemise * discount) / 100;
                      const totalLigneHT = totalLigneAvantRemise - montantRemise;
                      
                      return (
                        <>
                          <tr key={index}>
                            <td className="px-4 py-3">
                              <select
                                value={item.product_id}
                                onChange={(e) => updateQuoteItem(index, 'product_id', e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                              >
                                <option value="">Sélectionner</option>
                                {products.map(product => (
                                  <option key={product.id} value={product.id}>{product.name}</option>
                                ))}
                              </select>
                              {(() => {
                                const desc =
                                  item.product_description ||
                                  products.find((p) => p.id === Number(item.product_id))?.description ||
                                  '';
                                return desc ? (
                                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap">
                                    {desc}
                                  </div>
                                ) : null;
                              })()}
                            </td>
                            <td className="px-4 py-3">
                              <input
                                type="number"
                                min="1"
                                value={item.quantity}
                                onChange={(e) => updateQuoteItem(index, 'quantity', e.target.value)}
                                className="w-20 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-col gap-1">
                                {needsConversion && (
                                  <span className="text-xs text-gray-500 dark:text-gray-400">
                                    {isModeTTC ? 'Prix TTC (devise produit)' : 'Prix HT (devise produit)'}
                                  </span>
                                )}
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={isModeTTC ? (Number.isFinite(prixTTC) ? prixTTC : '') : item.unit_price}
                                  onChange={(e) => {
                                    const v = parseFloat(e.target.value);
                                    if (isModeTTC && Number.isFinite(v) && tvaRate >= 0) {
                                      const ht = v / (1 + tvaRate / 100);
                                      updateQuoteItem(index, 'unit_price', ht);
                                    } else {
                                      updateQuoteItem(index, 'unit_price', e.target.value);
                                    }
                                  }}
                                  className="w-24 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-right"
                                />
                                {needsConversion && (
                                  <span className="text-xs text-gray-500 dark:text-gray-400">
                                    = {isModeTTC ? (prixHTConverti * (1 + tvaRate / 100)).toFixed(2) : prixHTConverti.toFixed(2)} {quoteCurrency?.symbol || '€'} (devise devis)
                                  </span>
                                )}
                              </div>
                            </td>
                            {formData.mode_calcul === 'ttc' && (
                              <td className="px-4 py-3">
                                <span className="text-gray-600 dark:text-gray-400">{item.vat_rate}%</span>
                              </td>
                            )}
                            <td className="px-4 py-3">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                max="100"
                                value={item.discount_percent}
                                onChange={(e) => updateQuoteItem(index, 'discount_percent', e.target.value)}
                                className="w-20 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-right"
                              />
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-gray-900 dark:text-white">
                              {totalLigneHT.toFixed(2)} {quoteCurrency?.symbol || '€'}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => removeQuoteItem(index)}
                                className="text-red-600 hover:text-red-800 dark:text-red-400"
                              >
                                🗑️
                              </button>
                            </td>
                          </tr>
                          {needsConversion && (
                            <tr key={`conversion-${index}`} className="bg-yellow-50 dark:bg-yellow-900/20">
                              <td colSpan="7" className="px-4 py-3">
                                <div className="flex items-center gap-4 p-3 bg-yellow-100 dark:bg-yellow-900/40 rounded-lg border border-yellow-300 dark:border-yellow-700">
                                  <div className="flex items-center gap-2">
                                    <span className="text-yellow-800 dark:text-yellow-200 font-medium">💱</span>
                                    <span className="text-sm text-yellow-800 dark:text-yellow-200">
                                      Conversion de devise requise
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 ml-auto">
                                    <span className="text-sm text-yellow-700 dark:text-yellow-300">
                                      {productCurrency?.code || '?'} → {quoteCurrency?.code || '?'}
                                    </span>
                                    <label className="text-sm text-yellow-700 dark:text-yellow-300">
                                      Taux de change:
                                    </label>
                                    <input
                                      type="number"
                                      step="0.0001"
                                      min="0.0001"
                                      value={item.exchange_rate || 1.0}
                                      onChange={(e) => updateQuoteItem(index, 'exchange_rate', e.target.value)}
                                      className="w-24 px-2 py-1 border border-yellow-400 dark:border-yellow-600 rounded bg-white dark:bg-gray-800 text-yellow-900 dark:text-yellow-100 text-sm focus:ring-2 focus:ring-yellow-500"
                                      placeholder="1.0000"
                                    />
                                    <span className="text-xs text-yellow-600 dark:text-yellow-400">
                                      ({prixHT.toFixed(2)} {productCurrency?.symbol || ''} × {exchangeRate.toFixed(4)} = {prixHTConverti.toFixed(2)} {quoteCurrency?.symbol || '€'})
                                    </span>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Totaux : en mode HT pas de TVA ni TTC ; en mode TTC affichage complet */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Totaux ({quoteCurrency?.code || 'devise du devis'})</h3>
            <div className="space-y-3">
              {formData.mode_calcul === 'ht' ? (
                /* Mode HT : Total HT seul, ou avec remise globale : montant remise + % + Total HT après remise */
                <>
                  {(parseFloat(formData.global_discount_percent) || 0) > 0 ? (
                    <>
                      <div className="flex justify-between text-gray-700 dark:text-gray-300">
                        <span>Total HT avant remise</span>
                        <span>{totals.totalHTAvantRemiseGlobale.toFixed(2)} {quoteCurrencySymbol}</span>
                      </div>
                      <div className="flex justify-between text-gray-700 dark:text-gray-300">
                        <span>Remise globale ({(formData.global_discount_percent || 0)}%)</span>
                        <span>- {totals.montantRemiseGlobale.toFixed(2)} {quoteCurrencySymbol}</span>
                      </div>
                      <div className="flex justify-between text-2xl font-bold text-gray-900 dark:text-white pt-2 border-t-2 border-gray-300 dark:border-gray-600">
                        <span>Total HT après remise</span>
                        <span>{totals.totalHTApresRemise.toFixed(2)} {quoteCurrencySymbol}</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between text-2xl font-bold text-gray-900 dark:text-white">
                      <span>Total HT</span>
                      <span>{totals.totalHTApresRemise.toFixed(2)} {quoteCurrencySymbol}</span>
                    </div>
                  )}
                  <div className="mt-4">
                    <div className="flex items-center gap-2 mb-2">
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Remise globale (optionnelle)
                      </label>
                      <select
                        value={formData.global_discount_type}
                        onChange={(e) => setFormData({...formData, global_discount_type: e.target.value})}
                        className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
                      >
                        <option value="%">%</option>
                        <option value="€">€</option>
                      </select>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={formData.global_discount_percent}
                        onChange={(e) => setFormData({...formData, global_discount_percent: e.target.value})}
                        className="w-24 px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                      />
                    </div>
                  </div>
                </>
              ) : (
                /* Mode TTC : affichage complet */
                <>
                  <div className="flex justify-between text-gray-700 dark:text-gray-300">
                    <span>Total HT avant remise</span>
                    <span>{totals.totalHTAvantRemise.toFixed(2)} {quoteCurrencySymbol}</span>
                  </div>
                  <div className="flex justify-between text-gray-700 dark:text-gray-300">
                    <span>Total HT après remise</span>
                    <span>{totals.totalHTApresRemise.toFixed(2)} {quoteCurrencySymbol}</span>
                  </div>
                  <div className="mt-4">
                    <div className="flex items-center gap-2 mb-2">
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Remise globale (optionnelle)
                      </label>
                      <select
                        value={formData.global_discount_type}
                        onChange={(e) => setFormData({...formData, global_discount_type: e.target.value})}
                        className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
                      >
                        <option value="%">%</option>
                        <option value="€">€</option>
                      </select>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={formData.global_discount_percent}
                        onChange={(e) => setFormData({...formData, global_discount_percent: e.target.value})}
                        className="w-24 px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                      />
                    </div>
                  </div>
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
                    <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">Détail TVA</div>
                    {Object.entries(totals.vatDetails).map(([key, vat]) => (
                      <div key={key} className="flex justify-between text-sm text-gray-700 dark:text-gray-300 mb-1">
                        <span>TVA {vat.rate}%</span>
                        <span>{vat.amount.toFixed(2)} {quoteCurrencySymbol}</span>
                      </div>
                    ))}
                    <div className="flex justify-between font-semibold text-gray-700 dark:text-gray-300 mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                      <span>Total TVA</span>
                      <span>{totals.totalTVA.toFixed(2)} {quoteCurrencySymbol}</span>
                    </div>
                  </div>
                  <div className="flex justify-between text-2xl font-bold text-gray-900 dark:text-white pt-3 border-t-2 border-gray-300 dark:border-gray-600">
                    <span>Total TTC</span>
                    <span>{totals.totalTTC.toFixed(2)} {quoteCurrencySymbol}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Boutons */}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowCreatePage(false)}
              className="px-6 py-2 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Annuler
            </button>
            <button
              type="submit"
              className="px-6 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200 font-medium"
            >
              {editingQuote ? 'Enregistrer' : 'Créer le devis'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-4xl mb-4">⏳</div>
          <p className="text-gray-500">Chargement des devis...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <header className="mb-8 flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white">Devis</h2>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Gérez vos devis et suivez leur statut</p>
        </div>
        <button 
          onClick={() => setShowCreatePage(true)}
          className="px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium flex items-center gap-2"
        >
          <span>➕</span>
          Nouveau devis
        </button>
      </header>

      {/* Barre de recherche et filtres */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Recherche */}
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              🔍 Recherche
            </label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1); // Réinitialiser à la première page lors de la recherche
              }}
              placeholder="Rechercher par numéro ou client..."
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            />
          </div>

          {/* Filtre par client */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              👤 Client
            </label>
            <select
              value={filterClient}
              onChange={(e) => {
                setFilterClient(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            >
              <option value="">Tous les clients</option>
              {uniqueClients.map(client => (
                <option key={client.id} value={client.id.toString()}>{client.name || 'Client inconnu'}</option>
              ))}
            </select>
          </div>

          {/* Filtre par statut */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              📊 Statut
            </label>
            <select
              value={filterStatus}
              onChange={(e) => {
                setFilterStatus(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            >
              <option value="">Tous les statuts</option>
              {statusOptions.map(status => (
                <option key={status.value} value={status.value}>{status.label}</option>
              ))}
            </select>
          </div>

          {/* Filtre par date - Date de début */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              📅 Du
            </label>
            <input
              type="date"
              value={filterDateFrom}
              onChange={(e) => {
                setFilterDateFrom(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            />
          </div>
        </div>

        {/* Ligne 2 : Date de fin */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mt-4">
          <div className="lg:col-start-5">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              📅 Au
            </label>
            <input
              type="date"
              value={filterDateTo}
              onChange={(e) => {
                setFilterDateTo(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            />
          </div>
        </div>

        {/* Bouton réinitialiser les filtres */}
        {(searchQuery || filterClient || filterStatus || filterDateFrom || filterDateTo) && (
          <div className="mt-4 flex justify-end">
            <button
              onClick={handleResetFilters}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
            >
              <span>↻</span>
              Réinitialiser les filtres
            </button>
          </div>
        )}

        {/* Affichage du nombre de résultats */}
        <div className="mt-4 text-sm text-gray-500 dark:text-gray-400">
          {filteredQuotes.length === quotes.length ? (
            <span>{quotes.length} devis au total</span>
          ) : (
            <span>
              {filteredQuotes.length} devis trouvé{filteredQuotes.length > 1 ? 's' : ''} 
              {' '}sur {quotes.length} au total
            </span>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8">
        {filteredQuotes.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-6xl mb-4">📄</div>
            <p className="text-gray-500 dark:text-gray-400 text-lg mb-2">
              {quotes.length === 0 ? 'Aucun devis trouvé' : 'Aucun devis ne correspond aux critères de recherche'}
            </p>
            {quotes.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">
              Créez votre premier devis en cliquant sur "Nouveau devis"
            </p>
            ) : (
              <button
                onClick={handleResetFilters}
                className="mt-4 px-4 py-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                Réinitialiser les filtres
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                    Numéro
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                    Client
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                    Devise
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                    Montant HT
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                    Statut
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {filteredQuotes.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((quote) => (
                  <tr key={quote.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 whitespace-nowrap text-gray-900 dark:text-white">
                      {quote.quote_number || quote.id}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600 dark:text-gray-300">
                      {quote.client_name || '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600 dark:text-gray-300">
                      {quote.date ? new Date(quote.date).toLocaleDateString() : '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600 dark-text-gray-300">
                      {quote.currency_code ? `${quote.currency_code} ${quote.currency_symbol || ''}` : '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right font-semibold text-gray-900 dark:text-white">
                      {quote.total_ht
                        ? `${Number(quote.total_ht).toFixed(2)}${quote.currency_symbol || ''}`
                        : '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-flex px-2 py-1 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200">
                        {getStatusLabel(quote.status || 'pending')}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium space-x-3">
                      <button 
                        onClick={() => handleViewQuote(quote.id)}
                        className="text-blue-600 hover:text-blue-800 dark:text-blue-400"
                        title="Voir les détails"
                      >
                        👁️
                      </button>
                      <button 
                        onClick={() => handleEditQuote(quote.id)}
                        className="text-blue-600 hover:text-blue-800 dark:text-blue-400"
                        title="Modifier"
                      >
                        ✏️
                      </button>
                      <button 
                        onClick={() => handleDeleteQuote(quote.id)}
                        className="text-red-600 hover:text-red-800 dark:text-red-400"
                        title="Supprimer"
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {filteredQuotes.length > 0 && (
        <div className="mt-4">
          <Pagination
            currentPage={currentPage}
            totalPages={Math.ceil(filteredQuotes.length / itemsPerPage)}
            onPageChange={(page) => {
              setCurrentPage(page);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        </div>
      )}

    </div>
  );
}

// Page Configuration (simplifiée)
function ConfigPage() {
  const [categories, setCategories] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [vatRates, setVatRates] = useState([]);
  const [smtpConfig, setSmtpConfig] = useState({
    server: 'smtp.gmail.com',
    port: '587',
    secure: false,
    user: 'votre@email.com',
    password: '',
    sender_email: 'contact@entreprise.com',
    sender_name: 'Mon Entreprise'
  });
  const [layoutConfig, setLayoutConfig] = useState({
    logo_url: '',
    logo_file_path: null,
    footer_text: ''
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState(null);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [categoryForm, setCategoryForm] = useState({ name: '', description: '' });
  const [showCurrencyModal, setShowCurrencyModal] = useState(false);
  const [editingCurrency, setEditingCurrency] = useState(null);
  const [currencyForm, setCurrencyForm] = useState({ code: '', name: '', symbol: '', decimals: 2 });
  const [showVatRateModal, setShowVatRateModal] = useState(false);
  const [editingVatRate, setEditingVatRate] = useState(null);
  const [vatRateForm, setVatRateForm] = useState({ rate: '', label: '' });
  const [uploadingLayoutLogo, setUploadingLayoutLogo] = useState(false);

  const loadCategories = async () => {
    try {
      const data = await api.get('/config/categories');
      setCategories(data);
    } catch (error) {
      console.error('Erreur chargement catégories:', error);
    }
  };

  const loadCurrencies = async () => {
    try {
      const data = await api.get('/config/currencies');
      setCurrencies(data);
    } catch (error) {
      console.error('Erreur chargement devises:', error);
    }
  };

  const loadVatRates = async () => {
    try {
      const data = await api.get('/config/vat-rates');
      setVatRates(data);
    } catch (error) {
      console.error('Erreur chargement taux TVA:', error);
    }
  };

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const [cats, curs, vats, smtp, layout] = await Promise.all([
          api.get('/config/categories'),
          api.get('/config/currencies'),
          api.get('/config/vat-rates'),
          api.get('/config/smtp').catch(() => ({})),
          api.get('/config/layout').catch(() => ({}))
        ]);
        setCategories(cats);
        setCurrencies(curs);
        setVatRates(vats);
        if (smtp && Object.keys(smtp).length > 0) {
          setSmtpConfig({
            server: smtp.server || 'smtp.gmail.com',
            port: smtp.port || '587',
            secure: smtp.secure === 'true' || smtp.secure === true,
            user: smtp.user || 'votre@email.com',
            password: smtp.password || '',
            sender_email: smtp.sender_email || 'contact@entreprise.com',
            sender_name: smtp.sender_name || 'Mon Entreprise'
          });
        }
        if (layout && Object.keys(layout).length > 0) {
          setLayoutConfig({
            logo_url: layout.logo_url || '',
            logo_file_path: layout.logo_file_path || null,
            footer_text: layout.footer_text || ''
          });
        }
      } catch (error) {
        console.error('Erreur chargement config:', error);
      } finally {
        setLoading(false);
      }
    };
    loadConfig();
  }, []);

  useEffect(() => {
    loadCurrencies();
  }, []);

  useEffect(() => {
    loadVatRates();
  }, []);

  const handleSaveSMTP = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await api.post('/config/smtp', smtpConfig);
      setMessage({ type: 'success', text: 'Configuration SMTP enregistrée avec succès' });
    } catch (error) {
      console.error('Erreur sauvegarde SMTP:', error);
      setMessage({ type: 'error', text: 'Erreur lors de l\'enregistrement' });
    } finally {
      setSaving(false);
    }
  };

  const handleTestSMTP = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const result = await api.post('/config/smtp/test', smtpConfig);
      setMessage({ type: 'success', text: result.message || 'Connexion SMTP réussie' });
    } catch (error) {
      console.error('Erreur test SMTP:', error);
      setMessage({ type: 'error', text: 'Erreur lors du test de connexion' });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveLayout = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await api.post('/config/layout', layoutConfig);
      setMessage({ type: 'success', text: 'Mise en page enregistrée avec succès' });
    } catch (error) {
      console.error('Erreur sauvegarde mise en page:', error);
      setMessage({ type: 'error', text: 'Erreur lors de l\'enregistrement de la mise en page' });
    } finally {
      setSaving(false);
    }
  };

  const handleUploadLayoutLogo = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    setUploadingLayoutLogo(true);
    setMessage(null);

    try {
      const form = new FormData();
      form.append('file', file);

      const response = await fetch(`${API_URL}/config/layout/logo`, {
        method: 'POST',
        body: form
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de l\'upload du logo');
      }

      if (data.logo_file_path) {
        const baseUrl = API_URL.replace('/api', '');
        const relativePath = data.logo_file_path.replace(/^uploads[\\/]/, '');
        setLayoutConfig((prev) => ({
          ...prev,
          logo_file_path: data.logo_file_path,
          logo_url: '', // si on utilise le fichier, on vide l’URL
          logo_preview: `${baseUrl}/uploads/${relativePath}`
        }));
      }

      setMessage({ type: 'success', text: 'Logo de l\'entreprise mis à jour avec succès' });
    } catch (error) {
      console.error('Erreur upload logo mise en page:', error);
      setMessage({ type: 'error', text: error.message || 'Erreur lors de l\'upload du logo' });
    } finally {
      setUploadingLayoutLogo(false);
    }
  };

  const handleOpenCategoryModal = (category = null) => {
    if (category) {
      setEditingCategory(category);
      setCategoryForm({ name: category.name || '', description: category.description || '' });
    } else {
      setEditingCategory(null);
      setCategoryForm({ name: '', description: '' });
    }
    setShowCategoryModal(true);
  };

  const handleCloseCategoryModal = () => {
    setShowCategoryModal(false);
    setEditingCategory(null);
    setCategoryForm({ name: '', description: '' });
  };

  const handleSaveCategory = async (e) => {
    e.preventDefault();
    try {
      if (editingCategory) {
        await api.put(`/config/categories/${editingCategory.id}`, categoryForm);
      } else {
        await api.post('/config/categories', categoryForm);
      }
      await loadCategories();
      handleCloseCategoryModal();
    } catch (error) {
      console.error('Erreur sauvegarde catégorie:', error);
      alert('Erreur lors de la sauvegarde de la catégorie');
    }
  };

  const handleDeleteCategory = async (id) => {
    if (!window.confirm('Confirmer la suppression de cette catégorie ?')) return;
    
    try {
      await api.delete(`/config/categories/${id}`);
      await loadCategories();
    } catch (error) {
      console.error('Erreur suppression catégorie:', error);
      const errorMsg = error.response?.data?.error || 'Erreur lors de la suppression';
      alert(errorMsg);
    }
  };

  const handleOpenCurrencyModal = (currency = null) => {
    if (currency) {
      setEditingCurrency(currency);
      setCurrencyForm({ 
        code: currency.code || '', 
        name: currency.name || '', 
        symbol: currency.symbol || '', 
        decimals: currency.decimals || 2 
      });
    } else {
      setEditingCurrency(null);
      setCurrencyForm({ code: '', name: '', symbol: '', decimals: 2 });
    }
    setShowCurrencyModal(true);
  };

  const handleCloseCurrencyModal = () => {
    setShowCurrencyModal(false);
    setEditingCurrency(null);
    setCurrencyForm({ code: '', name: '', symbol: '', decimals: 2 });
  };

  const handleSaveCurrency = async (e) => {
    e.preventDefault();
    try {
      if (editingCurrency) {
        await api.put(`/config/currencies/${editingCurrency.id}`, currencyForm);
      } else {
        await api.post('/config/currencies', currencyForm);
      }
      await loadCurrencies();
      handleCloseCurrencyModal();
    } catch (error) {
      console.error('Erreur sauvegarde devise:', error);
      const errorMsg = error.response?.data?.error || 'Erreur lors de la sauvegarde de la devise';
      alert(errorMsg);
    }
  };

  const handleDeleteCurrency = async (id) => {
    if (!window.confirm('Confirmer la suppression de cette devise ?')) return;
    
    try {
      await api.delete(`/config/currencies/${id}`);
      await loadCurrencies();
    } catch (error) {
      console.error('Erreur suppression devise:', error);
      const errorMsg = error.response?.data?.error || 'Erreur lors de la suppression';
      alert(errorMsg);
    }
  };

  const handleOpenVatRateModal = (vatRate = null) => {
    if (vatRate) {
      setEditingVatRate(vatRate);
      setVatRateForm({ rate: vatRate.rate || '', label: vatRate.label || '' });
    } else {
      setEditingVatRate(null);
      setVatRateForm({ rate: '', label: '' });
    }
    setShowVatRateModal(true);
  };

  const handleCloseVatRateModal = () => {
    setShowVatRateModal(false);
    setEditingVatRate(null);
    setVatRateForm({ rate: '', label: '' });
  };

  const handleSaveVatRate = async (e) => {
    e.preventDefault();
    try {
      if (editingVatRate) {
        await api.put(`/config/vat-rates/${editingVatRate.id}`, vatRateForm);
      } else {
        await api.post('/config/vat-rates', vatRateForm);
      }
      await loadVatRates();
      handleCloseVatRateModal();
    } catch (error) {
      console.error('Erreur sauvegarde taux TVA:', error);
      const errorMsg = error.response?.data?.error || 'Erreur lors de la sauvegarde du taux de TVA';
      alert(errorMsg);
    }
  };

  const handleDeleteVatRate = async (id) => {
    if (!window.confirm('Confirmer la suppression de ce taux de TVA ?')) return;
    
    try {
      await api.delete(`/config/vat-rates/${id}`);
      await loadVatRates();
    } catch (error) {
      console.error('Erreur suppression taux TVA:', error);
      const errorMsg = error.response?.data?.error || 'Erreur lors de la suppression';
      alert(errorMsg);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-4xl mb-4">⏳</div>
          <p className="text-gray-500">Chargement de la configuration...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <header>
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white">Configuration</h2>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Données de base de l'application</p>
      </header>

      {/* Mise en page */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-2xl">🖨️</span>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Mise en page</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Définissez le logo de l'entreprise et le texte de pied de page utilisé sur les devis.
            </p>
          </div>
        </div>

        <form onSubmit={handleSaveLayout} className="space-y-4">
          {/* Logo entreprise */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Logo de l'entreprise
            </label>
            <div className="space-y-2">
              {(layoutConfig.logo_preview || layoutConfig.logo_url) && (
                <img
                  src={layoutConfig.logo_preview || layoutConfig.logo_url}
                  alt="Logo de l'entreprise"
                  className="h-16 object-contain border border-gray-200 dark:border-gray-700 bg-white rounded"
                />
              )}
              <input
                type="file"
                accept="image/*"
                onChange={handleUploadLayoutLogo}
                disabled={uploadingLayoutLogo}
                className="w-full text-sm text-gray-700 dark:text-gray-300"
              />
              {uploadingLayoutLogo && (
                <p className="text-xs text-blue-500 mt-1">Upload du logo en cours...</p>
              )}
            </div>
          </div>

          {/* URL logo */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              URL du logo
            </label>
            <input
              type="url"
              value={layoutConfig.logo_url}
              onChange={(e) =>
                setLayoutConfig((prev) => ({
                  ...prev,
                  logo_url: e.target.value,
                  logo_file_path: e.target.value ? null : prev.logo_file_path,
                  logo_preview: e.target.value || prev.logo_preview
                }))
              }
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-sm"
              placeholder="https://exemple.com/logo.png"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Si une URL est renseignée, elle sera utilisée comme logo prioritaire.
            </p>
            <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
              Pour que le logo apparaisse correctement dans le PDF des devis, il est fortement recommandé d&apos;utiliser un fichier téléversé plutôt qu&apos;une URL externe.
            </p>
          </div>

          {/* Texte pied de page */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Texte pied de page
            </label>
            <textarea
              value={layoutConfig.footer_text}
              onChange={(e) =>
                setLayoutConfig((prev) => ({ ...prev, footer_text: e.target.value }))
              }
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-sm"
              placeholder="Texte qui apparaîtra en bas des pages (adresse, mentions légales, etc.)"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50"
            >
              {saving ? 'Enregistrement...' : 'Enregistrer la mise en page'}
            </button>
          </div>
        </form>
      </div>

      {/* Configuration SMTP */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-2xl">📧</span>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Configuration SMTP</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Configurez les paramètres d'envoi d'e-mails pour envoyer les devis aux clients
            </p>
          </div>
        </div>

        {message && (
          <div className={`mb-4 p-3 rounded-lg ${
            message.type === 'success' 
              ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200'
              : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
          }`}>
            {message.text}
          </div>
        )}

        <form onSubmit={handleSaveSMTP} className="space-y-6">
          <div className="grid grid-cols-2 gap-6">
            {/* Colonne gauche */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Serveur SMTP *
                </label>
                <input
                  type="text"
                  required
                  value={smtpConfig.server}
                  onChange={(e) => setSmtpConfig({...smtpConfig, server: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="smtp.gmail.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Connexion sécurisée (SSL/TLS)
                </label>
                <div className="flex items-center">
                  <button
                    type="button"
                    onClick={() => setSmtpConfig({...smtpConfig, secure: !smtpConfig.secure})}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      smtpConfig.secure ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        smtpConfig.secure ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                  <span className="ml-3 text-sm text-gray-600 dark:text-gray-400">
                    {smtpConfig.secure ? 'Activé' : 'Désactivé'}
                  </span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Nom d'utilisateur *
                </label>
                <input
                  type="text"
                  required
                  value={smtpConfig.user}
                  onChange={(e) => setSmtpConfig({...smtpConfig, user: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="votre@email.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  E-mail expéditeur *
                </label>
                <input
                  type="email"
                  required
                  value={smtpConfig.sender_email}
                  onChange={(e) => setSmtpConfig({...smtpConfig, sender_email: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="contact@entreprise.com"
                />
              </div>
            </div>

            {/* Colonne droite */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Port *
                </label>
                <input
                  type="number"
                  required
                  value={smtpConfig.port}
                  onChange={(e) => setSmtpConfig({...smtpConfig, port: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="587"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Mot de passe *
                </label>
                <input
                  type="password"
                  required
                  value={smtpConfig.password}
                  onChange={(e) => setSmtpConfig({...smtpConfig, password: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="••••••••"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Nom expéditeur *
                </label>
                <input
                  type="text"
                  required
                  value={smtpConfig.sender_name}
                  onChange={(e) => setSmtpConfig({...smtpConfig, sender_name: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="Mon Entreprise"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={handleTestSMTP}
              disabled={testing}
              className="px-6 py-2 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              {testing ? 'Test en cours...' : 'Tester la connexion'}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200 font-medium disabled:opacity-50"
            >
              {saving ? 'Enregistrement...' : 'Enregistrer la configuration'}
            </button>
          </div>
        </form>
      </div>

      {/* Section Catégories */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Catégories</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Gérez les catégories de produits</p>
          </div>
          <button
            onClick={() => handleOpenCategoryModal()}
            className="px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200 font-medium flex items-center gap-2"
          >
            <span>+</span>
            Ajouter une catégorie
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Nom
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Description
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {categories.length === 0 ? (
                <tr>
                  <td colSpan="3" className="px-6 py-12 text-center">
                    <div className="text-4xl mb-2">📦</div>
                    <p className="text-gray-500 dark:text-gray-400">Aucune catégorie trouvée</p>
                  </td>
                </tr>
              ) : (
                categories.map(category => (
                  <tr key={category.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="font-medium text-gray-900 dark:text-white">{category.name}</div>
                    </td>
                    <td className="px-6 py-4 text-gray-600 dark:text-gray-400">
                      {category.description || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-3">
                      <button
                        onClick={() => handleOpenCategoryModal(category)}
                        className="text-blue-600 hover:text-blue-800 dark:text-blue-400"
                        title="Modifier"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => handleDeleteCategory(category.id)}
                        className="text-red-600 hover:text-red-800 dark:text-red-400"
                        title="Supprimer"
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Catégorie */}
      {showCategoryModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                {editingCategory ? 'Modifier la catégorie' : 'Nouvelle catégorie'}
              </h3>
              <button
                onClick={handleCloseCategoryModal}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveCategory} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Nom *
                </label>
                <input
                  type="text"
                  required
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm({...categoryForm, name: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="Nom de la catégorie"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Description
                </label>
                <textarea
                  value={categoryForm.description}
                  onChange={(e) => setCategoryForm({...categoryForm, description: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="Description de la catégorie"
                  rows="3"
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={handleCloseCategoryModal}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200 font-medium"
                >
                  {editingCategory ? 'Modifier' : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Section Devises */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Devises</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Gérez les devises disponibles pour les produits</p>
          </div>
          <button
            onClick={() => handleOpenCurrencyModal()}
            className="px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200 font-medium flex items-center gap-2"
          >
            <span>+</span>
            Ajouter une devise
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Code
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Symbole
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Nom
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Décimales
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {currencies.length === 0 ? (
                <tr>
                  <td colSpan="5" className="px-6 py-12 text-center">
                    <div className="text-4xl mb-2">💱</div>
                    <p className="text-gray-500 dark:text-gray-400">Aucune devise trouvée</p>
                  </td>
                </tr>
              ) : (
                currencies.map(currency => (
                  <tr key={currency.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="font-medium text-gray-900 dark:text-white">{currency.code}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-600 dark:text-gray-400">
                      {currency.symbol}
                    </td>
                    <td className="px-6 py-4 text-gray-600 dark:text-gray-400">
                      {currency.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-600 dark:text-gray-400">
                      {currency.decimals || 2}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-3">
                      <button
                        onClick={() => handleOpenCurrencyModal(currency)}
                        className="text-blue-600 hover:text-blue-800 dark:text-blue-400"
                        title="Modifier"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => handleDeleteCurrency(currency.id)}
                        className="text-red-600 hover:text-red-800 dark:text-red-400"
                        title="Supprimer"
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Devise */}
      {showCurrencyModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                {editingCurrency ? 'Modifier la devise' : 'Nouvelle devise'}
              </h3>
              <button
                onClick={handleCloseCurrencyModal}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveCurrency} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Code *
                </label>
                <input
                  type="text"
                  required
                  maxLength="10"
                  value={currencyForm.code}
                  onChange={(e) => setCurrencyForm({...currencyForm, code: e.target.value.toUpperCase()})}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="EUR"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Symbole *
                </label>
                <input
                  type="text"
                  required
                  maxLength="10"
                  value={currencyForm.symbol}
                  onChange={(e) => setCurrencyForm({...currencyForm, symbol: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="€"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Nom *
                </label>
                <input
                  type="text"
                  required
                  value={currencyForm.name}
                  onChange={(e) => setCurrencyForm({...currencyForm, name: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="Euro"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Décimales *
                </label>
                <input
                  type="number"
                  required
                  min="0"
                  max="6"
                  value={currencyForm.decimals}
                  onChange={(e) => setCurrencyForm({...currencyForm, decimals: parseInt(e.target.value) || 2})}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="2"
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={handleCloseCurrencyModal}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200 font-medium"
                >
                  {editingCurrency ? 'Modifier' : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Section Taux de TVA */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Taux de TVA</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Gérez les taux de TVA disponibles</p>
          </div>
          <button
            onClick={() => handleOpenVatRateModal()}
            className="px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200 font-medium flex items-center gap-2"
          >
            <span>+</span>
            Ajouter un taux
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Taux
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Libellé
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {vatRates.length === 0 ? (
                <tr>
                  <td colSpan="3" className="px-6 py-12 text-center">
                    <div className="text-4xl mb-2">📊</div>
                    <p className="text-gray-500 dark:text-gray-400">Aucun taux de TVA trouvé</p>
                  </td>
                </tr>
              ) : (
                vatRates.map(vatRate => (
                  <tr key={vatRate.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="font-medium text-gray-900 dark:text-white">{vatRate.rate}%</div>
                    </td>
                    <td className="px-6 py-4 text-gray-600 dark:text-gray-400">
                      {vatRate.label}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-3">
                      <button
                        onClick={() => handleOpenVatRateModal(vatRate)}
                        className="text-blue-600 hover:text-blue-800 dark:text-blue-400"
                        title="Modifier"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => handleDeleteVatRate(vatRate.id)}
                        className="text-red-600 hover:text-red-800 dark:text-red-400"
                        title="Supprimer"
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Taux de TVA */}
      {showVatRateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                {editingVatRate ? 'Modifier le taux de TVA' : 'Nouveau taux de TVA'}
              </h3>
              <button
                onClick={handleCloseVatRateModal}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveVatRate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Taux (%) *
                </label>
                <input
                  type="number"
                  required
                  step="0.01"
                  min="0"
                  max="100"
                  value={vatRateForm.rate}
                  onChange={(e) => setVatRateForm({...vatRateForm, rate: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="19.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Libellé *
                </label>
                <input
                  type="text"
                  required
                  value={vatRateForm.label}
                  onChange={(e) => setVatRateForm({...vatRateForm, label: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="TVA normale"
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={handleCloseVatRateModal}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200 font-medium"
                >
                  {editingVatRate ? 'Modifier' : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Page Utilisateurs
function UsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    role: 'lecteur'
  });

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const data = await api.get('/users');
      setUsers(data);
    } catch (error) {
      console.error('Erreur chargement utilisateurs:', error);
      alert('Erreur lors du chargement des utilisateurs');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingUser) {
        await api.put(`/users/${editingUser.id}`, formData);
      } else {
        await api.post('/users', formData);
      }
      setShowModal(false);
      setEditingUser(null);
      setFormData({ name: '', email: '', password: '', role: 'lecteur' });
      loadUsers();
      setCurrentPage(1); // Réinitialiser à la première page après création/modification
    } catch (error) {
      console.error('Erreur sauvegarde utilisateur:', error);
      const errorMessage = error.message || 'Erreur lors de la sauvegarde';
      alert(errorMessage);
    }
  };

  const handleEdit = (user) => {
    setEditingUser(user);
    setFormData({
      name: user.name || '',
      email: user.email || '',
      password: '', // Ne pas pré-remplir le mot de passe
      role: user.role || 'lecteur'
    });
    setShowModal(true);
  };

  // Filtrer les utilisateurs
  const filteredUsers = users.filter(user => {
    // Recherche textuelle (nom ou email)
    const matchesSearch = searchQuery === '' || 
      user.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email?.toLowerCase().includes(searchQuery.toLowerCase());
    
    // Filtre par rôle
    const matchesRole = filterRole === '' || 
      (user.role || 'lecteur').toLowerCase() === filterRole.toLowerCase();
    
    // Filtre par date de création
    let matchesDate = true;
    if (filterDateFrom) {
      const userDate = user.created_at ? new Date(user.created_at) : null;
      const fromDate = new Date(filterDateFrom);
      if (!userDate || userDate < fromDate) {
        matchesDate = false;
      }
    }
    if (filterDateTo) {
      const userDate = user.created_at ? new Date(user.created_at) : null;
      const toDate = new Date(filterDateTo);
      toDate.setHours(23, 59, 59, 999); // Fin de journée
      if (!userDate || userDate > toDate) {
        matchesDate = false;
      }
    }
    
    return matchesSearch && matchesRole && matchesDate;
  });

  // Réinitialiser les filtres
  const handleResetFilters = () => {
    setSearchQuery('');
    setFilterRole('');
    setFilterDateFrom('');
    setFilterDateTo('');
    setCurrentPage(1);
  };

  // Rôles disponibles
  const roleOptions = [
    { value: 'admin', label: 'Administrateur' },
    { value: 'commercial', label: 'Commercial' },
    { value: 'lecteur', label: 'Lecteur' }
  ];

  const handleDelete = async (id) => {
    if (!window.confirm('Êtes-vous sûr de vouloir supprimer cet utilisateur ?')) {
      return;
    }
    try {
      await api.delete(`/users/${id}`);
      loadUsers();
      // Réinitialiser à la première page si on supprime le dernier élément de la dernière page
      const maxPage = Math.ceil((filteredUsers.length - 1) / itemsPerPage);
      if (currentPage > maxPage && maxPage > 0) {
        setCurrentPage(maxPage);
      }
    } catch (error) {
      console.error('Erreur suppression utilisateur:', error);
      const errorMessage = error.message || 'Erreur lors de la suppression';
      alert(errorMessage);
    }
  };

  const handleCancel = () => {
    setShowModal(false);
    setEditingUser(null);
    setFormData({ name: '', email: '', password: '', role: 'lecteur' });
  };

  const getRoleLabel = (role) => {
    const labels = {
      'admin': 'Administrateur',
      'commercial': 'Commercial',
      'lecteur': 'Lecteur'
    };
    return labels[role] || role;
  };

  const getRoleBadgeColor = (role) => {
    const colors = {
      'admin': 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200',
      'commercial': 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
      'lecteur': 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
    };
    return colors[role] || 'bg-gray-100 text-gray-800';
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="text-center">
          <p className="text-gray-500 dark:text-gray-400">Chargement...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white">Utilisateurs</h2>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Gestion des utilisateurs et des rôles</p>
        </div>
        <button
          onClick={() => {
            setEditingUser(null);
            setFormData({ name: '', email: '', password: '', role: 'lecteur' });
            setShowModal(true);
          }}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium flex items-center gap-2"
        >
          <span>➕</span>
          Ajouter un utilisateur
        </button>
      </div>

      {/* Barre de recherche et filtres */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Recherche */}
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              🔍 Recherche
            </label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1); // Réinitialiser à la première page lors de la recherche
              }}
              placeholder="Rechercher par nom ou email..."
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            />
          </div>

          {/* Filtre par rôle */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              👤 Rôle
            </label>
            <select
              value={filterRole}
              onChange={(e) => {
                setFilterRole(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            >
              <option value="">Tous les rôles</option>
              {roleOptions.map(role => (
                <option key={role.value} value={role.value}>{role.label}</option>
              ))}
            </select>
          </div>

          {/* Filtre par date - Date de début */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              📅 Du
            </label>
            <input
              type="date"
              value={filterDateFrom}
              onChange={(e) => {
                setFilterDateFrom(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            />
          </div>

          {/* Filtre par date - Date de fin */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              📅 Au
            </label>
            <input
              type="date"
              value={filterDateTo}
              onChange={(e) => {
                setFilterDateTo(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            />
          </div>
        </div>

        {/* Bouton réinitialiser les filtres */}
        {(searchQuery || filterRole || filterDateFrom || filterDateTo) && (
          <div className="mt-4 flex justify-end">
            <button
              onClick={handleResetFilters}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
            >
              <span>↻</span>
              Réinitialiser les filtres
            </button>
          </div>
        )}

        {/* Affichage du nombre de résultats */}
        <div className="mt-4 text-sm text-gray-500 dark:text-gray-400">
          {filteredUsers.length === users.length ? (
            <span>{users.length} utilisateur{users.length > 1 ? 's' : ''} au total</span>
          ) : (
            <span>
              {filteredUsers.length} utilisateur{filteredUsers.length > 1 ? 's' : ''} trouvé{filteredUsers.length > 1 ? 's' : ''} 
              {' '}sur {users.length} au total
            </span>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        {filteredUsers.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-gray-500 dark:text-gray-400">
              {users.length === 0 ? 'Aucun utilisateur' : 'Aucun utilisateur ne correspond aux critères de recherche'}
            </p>
            {(searchQuery || filterRole || filterDateFrom || filterDateTo) && users.length > 0 && (
              <button
                onClick={handleResetFilters}
                className="mt-4 px-4 py-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                Réinitialiser les filtres
              </button>
            )}
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Nom
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Rôle
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Date de création
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {filteredUsers.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((user) => (
                <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900 dark:text-white">{user.name}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-500 dark:text-gray-400">{user.email}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 rounded-full text-xs font-semibold ${getRoleBadgeColor(user.role)}`}>
                      {getRoleLabel(user.role)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-500 dark:text-gray-400">{formatDate(user.created_at)}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => handleEdit(user)}
                      className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300 mr-4"
                    >
                      ✏️ Modifier
                    </button>
                    <button
                      onClick={() => handleDelete(user.id)}
                      className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                    >
                      🗑️ Supprimer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        
        {filteredUsers.length > 0 && (
          <Pagination
            currentPage={currentPage}
            totalPages={Math.ceil(filteredUsers.length / itemsPerPage)}
            onPageChange={(page) => {
              setCurrentPage(page);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        )}
      </div>

      {/* Modal Ajout/Modification */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-6">
              {editingUser ? 'Modifier l\'utilisateur' : 'Nouvel utilisateur'}
            </h3>
            <form onSubmit={handleSubmit}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Nom complet *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="Jean Dupont"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Email *
                  </label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({...formData, email: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="jean.dupont@example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Mot de passe {editingUser ? '(laisser vide pour ne pas modifier)' : '*'}
                  </label>
                  <input
                    type="password"
                    required={!editingUser}
                    value={formData.password}
                    onChange={(e) => setFormData({...formData, password: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="••••••••"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Rôle *
                  </label>
                  <select
                    required
                    value={formData.role}
                    onChange={(e) => setFormData({...formData, role: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  >
                    <option value="admin">Administrateur - Accès complet</option>
                    <option value="commercial">Commercial - Accès complet sauf utilisateurs et configuration</option>
                    <option value="lecteur">Lecteur - Accès uniquement à devis et dashboard</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                >
                  {editingUser ? 'Modifier' : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function ConfigSection({ title, items, renderItem }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">{title}</h3>
      {items.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 text-sm">Aucune donnée</p>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
          {items.map((item) => (
            <li key={item.id} className="py-2 text-gray-700 dark:text-gray-200">
              {renderItem(item)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}