import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, Navigate, useNavigate, useParams, useLocation } from 'react-router-dom';
import '@tdesign-react/chat/es/style/index.js';

import { useAgents } from './hooks/useAgents';
import { useTheme } from './hooks/useTheme';
import { useSessions } from './hooks/useSessions';
import { useModels } from './hooks/useModels';
import { useChat } from './hooks/useChat';

import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { ChatPage } from './pages/ChatPage';
import { AdminPage } from './pages/AdminPage';
import { UserAuthDialog } from './components/UserAuthDialog';
import { authedFetch, getUserToken, isUserLoggedIn, clearUserToken } from './utils/userAuth';

function App() {
  return (
    <Routes>
      <Route path="/" element={<AppContent />} />
      <Route path="/chat/:sessionId" element={<AppContent />} />
      {/* 管理后台仅通过 /admin 直链访问（密码门控），普通用户界面无入口 */}
      <Route path="/admin" element={<AppContent />} />
      {/* 网页挂件 iframe 页面（embed.js 引用，侧边栏隐藏的精简对话视图） */}
      <Route path="/widget" element={<AppContent />} />
      <Route path="/settings" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function AppContent() {
  const navigate = useNavigate();
  const { sessionId: urlSessionId } = useParams<{ sessionId: string }>();
  const location = useLocation();
  const isAdminPage = location.pathname === '/admin';
  const isWidgetPage = location.pathname === '/widget';

  // Hooks
  const { theme, toggleTheme } = useTheme();
  const { agents, addAgent, updateAgent, deleteAgent, getAgent } = useAgents();
  const { models, selectedModel, setSelectedModel, fetchModels } = useModels();
  const {
    sessions,
    setSessions,
    currentSessionId,
    setCurrentSessionId,
    currentSession,
    sessionModels,
    fetchSessions,
    loadSessionMessages,
    deleteSession,
    updateSessionModel,
  } = useSessions();

  // 聊天 Hook
  const {
    isLoading,
    inputValue,
    setInputValue,
    sendMessage,
    handleStop,
  } = useChat({
    currentSession,
    currentSessionId,
    selectedModel,
    getAgent,
    updateSessionModel,
    setCurrentSessionId,
    setSessions,
  });

  // 获取当前会话的 Agent
  const currentAgent = currentSession?.agentId ? getAgent(currentSession.agentId) : getAgent('default');

  // 从 URL 同步 sessionId
  useEffect(() => {
    if (urlSessionId && urlSessionId !== currentSessionId) {
      setCurrentSessionId(urlSessionId);
    } else if (!urlSessionId && !isAdminPage && currentSessionId) {
      setCurrentSessionId(null);
    }
  }, [urlSessionId, isAdminPage, currentSessionId, setCurrentSessionId]);

  // 当切换会话时，恢复该会话的模型选择
  useEffect(() => {
    if (currentSessionId && sessionModels[currentSessionId]) {
      setSelectedModel(sessionModels[currentSessionId]);
    } else if (currentSession) {
      setSelectedModel(currentSession.model);
    }
  }, [currentSessionId, sessionModels, currentSession, setSelectedModel]);

  // 初始加载会话列表
  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // 更新当前会话的模型
  const updateCurrentSessionModel = useCallback((modelId: string) => {
    setSelectedModel(modelId);
    if (currentSessionId) {
      updateSessionModel(currentSessionId, modelId);
    }
  }, [currentSessionId, updateSessionModel, setSelectedModel]);

  // 删除会话处理
  const handleDeleteSession = useCallback(async (sessionId: string) => {
    const navigateTo = await deleteSession(sessionId);
    if (navigateTo) {
      navigate(navigateTo);
    }
  }, [deleteSession, navigate]);

  // 侧边栏事件处理
  const handleNewChat = useCallback(() => {
    setCurrentSessionId(null);
    navigate('/');
  }, [navigate, setCurrentSessionId]);

  const handleSelectSession = useCallback((sessionId: string) => {
    setCurrentSessionId(sessionId);
    navigate(`/chat/${sessionId}`);
  }, [navigate, setCurrentSessionId]);

  // Sidebar 状态
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // 账号（跨设备同步会话）
  const [accountOpen, setAccountOpen] = useState(false);
  const [loggedInUsername, setLoggedInUsername] = useState<string | null>(() => (isUserLoggedIn() ? '…' : null));

  // 启动时校验 token 并取用户名
  useEffect(() => {
    if (!getUserToken()) { setLoggedInUsername(null); return; }
    authedFetch('/api/auth/me')
      .then(r => r.json())
      .then(j => { setLoggedInUsername(j.loggedIn ? j.username : (clearUserToken(), null)); })
      .catch(() => {});
  }, []);

  const refreshSessionsAfterAuth = useCallback(() => {
    authedFetch('/api/auth/me')
      .then(r => r.json())
      .then(j => setLoggedInUsername(j.loggedIn ? j.username : null))
      .catch(() => {});
    fetchSessions(); // 身份变化后按新身份重新拉取会话列表
  }, [fetchSessions]);

  return (
    <div
      className="flex h-screen w-screen"
      style={{ backgroundColor: 'var(--td-bg-color-page)' }}
    >
      {/* 侧边栏（管理后台/挂件下隐藏） */}
      {!isAdminPage && !isWidgetPage && (
        <Sidebar
          sessions={sessions}
          currentSessionId={currentSessionId}
          sidebarOpen={sidebarOpen}
          agents={agents}
          getAgent={getAgent}
          onNewChat={handleNewChat}
          onSelectSession={handleSelectSession}
          onDeleteSession={handleDeleteSession}
        />
      )}

      {/* 主内容区 */}
      <main
        className="flex-1 flex flex-col min-w-0"
        style={{ backgroundColor: 'var(--td-bg-color-page)' }}
      >
        <Header
          isAdminPage={isAdminPage || isWidgetPage}
          sidebarOpen={sidebarOpen}
          theme={theme}
          currentSession={currentSession}
          currentAgent={currentAgent}
          models={models}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          onToggleTheme={toggleTheme}
          onRefreshModels={fetchModels}
          loggedInUsername={loggedInUsername}
          onOpenAccount={() => setAccountOpen(true)}
        />

        <UserAuthDialog
          visible={accountOpen}
          onClose={() => setAccountOpen(false)}
          onChanged={refreshSessionsAfterAuth}
          loggedInUsername={loggedInUsername}
        />

        {isAdminPage ? (
          <AdminPage
            agents={agents}
            onAdd={addAgent}
            onUpdate={updateAgent}
            onDelete={deleteAgent}
          />
        ) : (
          <ChatPage
            currentSession={currentSession}
            models={models}
            selectedModel={selectedModel}
            agents={agents}
            isLoading={isLoading}
            inputValue={inputValue}
            onSendMessage={sendMessage}
            onStop={handleStop}
            onInputChange={setInputValue}
            onModelChange={updateCurrentSessionModel}
            onRefreshMessages={loadSessionMessages}
          />
        )}
      </main>
    </div>
  );
}

export default App;
