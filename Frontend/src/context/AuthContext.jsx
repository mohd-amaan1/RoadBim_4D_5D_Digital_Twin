import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, tokenStore, setUnauthorizedHandler } from '../api/client';

const AuthContext = createContext();

/**
 * Session state.
 *
 * The token lives in localStorage so a refresh does not sign the user out, and the
 * active project code alongside it so a refresh lands back where they were. Everything
 * else — membership, roles — is re-read from the server on each request, so revoking
 * access takes effect immediately rather than when the token expires.
 */
const PROJECT_KEY = 'roadbim.projectCode';
const PACKAGE_KEY = 'roadbim.packageId';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => tokenStore.getUser());
  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  // Every package in the active project. The map draws all of them; the import wizard and
  // the model upload write into exactly one.
  const [packages, setPackages] = useState([]);
  const [activePackage, setActivePackage] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | signedOut | ready
  const [error, setError] = useState(null);
  // True while the server has sign-in switched off and is authenticating every request as
  // one shared administrator. Reported by /api/auth/me rather than configured here, so the
  // backend switch is the only one — the two can never be set to disagree.
  const [authDisabled, setAuthDisabled] = useState(false);

  const signOut = useCallback(() => {
    tokenStore.clear();
    localStorage.removeItem(PROJECT_KEY);
    localStorage.removeItem(PACKAGE_KEY);
    setUser(null);
    setProjects([]);
    setActiveProject(null);
    setPackages([]);
    setActivePackage(null);
    setStatus('signedOut');
  }, []);

  // A 401 anywhere drops the session rather than leaving half-loaded state on screen
  useEffect(() => {
    setUnauthorizedHandler(() => signOut());
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  const refreshProjects = useCallback(async (preferredCode) => {
    const list = await api.listProjects();
    setProjects(list);

    const wanted = preferredCode || localStorage.getItem(PROJECT_KEY);
    const chosen = list.find((p) => p.code === wanted) || list[0] || null;
    setActiveProject(chosen);
    if (chosen) localStorage.setItem(PROJECT_KEY, chosen.code);
    return list;
  }, []);

  // Restore an existing session on load.
  //
  // The server is asked even with no token in hand. Holding no token used to be treated as
  // proof of being signed out, but that is only true while sign-in is on: with shared access
  // the server authenticates the request itself, and short-circuiting here would show a
  // sign-in screen for a session that does not have sign-in. A 401 still lands on the same
  // screen, one request later, so nothing is lost when sign-in is on.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api.me();
        if (cancelled) return;
        setUser(me);
        setAuthDisabled(Boolean(me.authDisabled));
        tokenStore.setUser(me);
        await refreshProjects();
        if (!cancelled) setStatus('ready');
      } catch {
        if (!cancelled) signOut();
      }
    })();
    return () => { cancelled = true; };
  }, [refreshProjects, signOut]);

  const afterAuth = useCallback(async (response) => {
    tokenStore.set(response.token);
    tokenStore.setUser(response.user);
    setUser(response.user);
    setError(null);
    await refreshProjects();
    setStatus('ready');
  }, [refreshProjects]);

  const signIn = useCallback(async (email, password) => {
    setError(null);
    try {
      await afterAuth(await api.login(email, password));
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }, [afterAuth]);

  const register = useCallback(async (email, password, displayName) => {
    setError(null);
    try {
      await afterAuth(await api.register(email, password, displayName));
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }, [afterAuth]);

  const selectProject = useCallback((codeOrProject) => {
    const code = typeof codeOrProject === 'string' ? codeOrProject : codeOrProject?.code;
    const found = projects.find((p) => p.code === code) || null;
    setActiveProject(found);
    if (found) localStorage.setItem(PROJECT_KEY, found.code);
    return found;
  }, [projects]);

  const createProject = useCallback(async (name, code, description) => {
    const created = await api.createProject(name, code, description);
    await refreshProjects(created.code);
    return created;
  }, [refreshProjects]);

  /* ---------------------------------------------------------------- packages */

  /**
   * Reloads the active project's packages and settles which one is selected.
   *
   * The remembered id is only honoured when it belongs to THIS project — otherwise
   * switching projects would leave a sibling project's package selected and every write
   * would land in the wrong contract.
   */
  const refreshPackages = useCallback(async (preferredId) => {
    if (!activeProject) {
      setPackages([]);
      setActivePackage(null);
      return [];
    }

    const list = await api.listPackages(activeProject.code);
    setPackages(list);

    const remembered = Number(localStorage.getItem(PACKAGE_KEY));
    const wanted = preferredId ?? remembered;
    const chosen = list.find((k) => k.id === wanted) || list[0] || null;

    setActivePackage(chosen);
    if (chosen) localStorage.setItem(PACKAGE_KEY, String(chosen.id));
    return list;
  }, [activeProject]);

  useEffect(() => {
    if (!activeProject) {
      setPackages([]);
      setActivePackage(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await api.listPackages(activeProject.code);
        if (cancelled) return;
        setPackages(list);
        const remembered = Number(localStorage.getItem(PACKAGE_KEY));
        const chosen = list.find((k) => k.id === remembered) || list[0] || null;
        setActivePackage(chosen);
        if (chosen) localStorage.setItem(PACKAGE_KEY, String(chosen.id));
      } catch {
        if (!cancelled) { setPackages([]); setActivePackage(null); }
      }
    })();
    return () => { cancelled = true; };
  }, [activeProject?.id]);

  const selectPackage = useCallback((idOrPackage) => {
    const id = typeof idOrPackage === 'object' ? idOrPackage?.id : Number(idOrPackage);
    const found = packages.find((k) => k.id === id) || null;
    setActivePackage(found);
    if (found) localStorage.setItem(PACKAGE_KEY, String(found.id));
    return found;
  }, [packages]);

  const createPackage = useCallback(async (fields) => {
    const created = await api.createPackage(activeProject.code, fields);
    await refreshPackages(created.id);
    return created;
  }, [activeProject, refreshPackages]);

  const updatePackage = useCallback(async (packageId, patch) => {
    const updated = await api.updatePackage(packageId, patch);
    await refreshPackages(packageId);
    return updated;
  }, [refreshPackages]);

  /** Contributor or Owner. A Viewer can read everything but change nothing. */
  const canEdit = ['Contributor', 'Owner'].includes(activeProject?.role) || user?.isSystemAdmin;

  return (
    <AuthContext.Provider value={{
      user, projects, activeProject, status, error, canEdit, authDisabled,
      signIn, register, signOut, selectProject, createProject, refreshProjects,
      packages, activePackage, selectPackage, createPackage, updatePackage, refreshPackages,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
