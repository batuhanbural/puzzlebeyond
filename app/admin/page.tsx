"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";

type AdminPuzzle = {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  rows: number;
  cols: number;
  count: number;
  accent: string;
  kind: string;
};

type AdminSession = {
  clientId: string;
  roomCode: string | null;
  lastSeenAt: number;
  lastSeenLabel: string;
};

type AdminData = {
  activeUsers: number;
  puzzles: AdminPuzzle[];
  sessions: AdminSession[];
};

async function responsePayload<T>(response: Response) {
  try {
    return await response.json() as T & { error?: string };
  } catch {
    return {} as T & { error?: string };
  }
}

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [configured, setConfigured] = useState(true);
  const [password, setPassword] = useState("");
  const [data, setData] = useState<AdminData | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [rows, setRows] = useState("3");
  const [cols, setCols] = useState("4");
  const [accent, setAccent] = useState("#d3d3ff");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const [galleryResponse, sessionsResponse] = await Promise.all([
      fetch("/api/admin/gallery", { cache: "no-store" }),
      fetch("/api/admin/sessions", { cache: "no-store" }),
    ]);
    if (galleryResponse.status === 401 || sessionsResponse.status === 401) {
      setAuthenticated(false);
      return;
    }
    const galleryPayload = await responsePayload<{ activeUsers: number; puzzles: AdminPuzzle[] }>(galleryResponse);
    const sessionsPayload = await responsePayload<{ activeUsers: number; sessions: AdminSession[] }>(sessionsResponse);
    if (!galleryResponse.ok) throw new Error(galleryPayload.error || "Admin verileri okunamadı.");
    if (!sessionsResponse.ok) throw new Error(sessionsPayload.error || "Oturumlar okunamadı.");
    setData({
      activeUsers: sessionsPayload.activeUsers ?? galleryPayload.activeUsers,
      puzzles: galleryPayload.puzzles || [],
      sessions: sessionsPayload.sessions || [],
    });
    setAuthenticated(true);
  }, []);

  useEffect(() => {
    void fetch("/api/admin/auth", { cache: "no-store" }).then(async (response) => {
      const payload = await responsePayload<{ authenticated: boolean; configured: boolean }>(response);
      setConfigured(payload.configured !== false);
      if (payload.authenticated) {
        setAuthenticated(true);
        await load();
      } else setAuthenticated(false);
    }).catch(() => {
      setAuthenticated((current) => current === null ? false : current);
      setNotice("Admin servisine ulaşılamadı.");
    });
  }, [load]);

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!password) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const payload = await responsePayload<{ ok?: boolean }>(response);
      if (!response.ok) throw new Error(payload.error || "Giriş yapılamadı.");
      setPassword("");
      setAuthenticated(true);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Giriş yapılamadı.");
    } finally {
      setBusy(false);
    }
  };

  const addPuzzle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file) {
      setNotice("Önce bir görsel seçmelisin.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const form = new FormData();
      form.append("title", title);
      form.append("description", description);
      form.append("rows", rows);
      form.append("cols", cols);
      form.append("accent", accent);
      form.append("image", file);
      const response = await fetch("/api/admin/gallery", { method: "POST", body: form });
      const payload = await responsePayload<{ puzzle?: AdminPuzzle }>(response);
      if (!response.ok) throw new Error(payload.error || "Puzzle eklenemedi.");
      setTitle("");
      setDescription("");
      setRows("3");
      setCols("4");
      setAccent("#d3d3ff");
      setFile(null);
      const input = document.getElementById("admin-image") as HTMLInputElement | null;
      if (input) input.value = "";
      setNotice("Puzzle galeriye eklendi.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Puzzle eklenemedi.");
    } finally {
      setBusy(false);
    }
  };

  const removePuzzle = async (puzzle: AdminPuzzle) => {
    if (!window.confirm("“" + puzzle.title + "” galeriden silinsin mi?")) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/gallery?id=" + encodeURIComponent(puzzle.id), { method: "DELETE" });
      const payload = await responsePayload<{ ok?: boolean }>(response);
      if (!response.ok) throw new Error(payload.error || "Puzzle silinemedi.");
      setNotice("Puzzle galeriden çıkarıldı.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Puzzle silinemedi.");
    } finally {
      setBusy(false);
    }
  };

  const closeSession = async (session: AdminSession) => {
    if (!window.confirm(`${session.clientId.slice(0, 8)}… oturumu kapatılsın mı?`)) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/sessions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: session.clientId }),
      });
      const payload = await responsePayload<{ closed?: number }>(response);
      if (!response.ok) throw new Error(payload.error || "Oturum kapatılamadı.");
      setNotice("Oturum kapatıldı.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Oturum kapatılamadı.");
    } finally {
      setBusy(false);
    }
  };

  const deleteSession = async (session: AdminSession) => {
    if (!window.confirm(`${session.clientId.slice(0, 8)}… oturum kaydı silinsin mi?`)) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/admin/sessions?clientId=${encodeURIComponent(session.clientId)}`, { method: "DELETE" });
      const payload = await responsePayload<{ deleted?: number }>(response);
      if (!response.ok) throw new Error(payload.error || "Oturum silinemedi.");
      setNotice("Oturum kaydı silindi.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Oturum silinemedi.");
    } finally {
      setBusy(false);
    }
  };

  const closeAllSessions = async () => {
    if (!data?.sessions.length || !window.confirm(`${data.sessions.length} aktif oturum kapatılsın mı?`)) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/sessions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      const payload = await responsePayload<{ closed?: number }>(response);
      if (!response.ok) throw new Error(payload.error || "Oturumlar kapatılamadı.");
      setNotice(`${payload.closed || data.sessions.length} oturum kapatıldı.`);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Oturumlar kapatılamadı.");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await fetch("/api/admin/auth", { method: "DELETE" });
    setAuthenticated(false);
    setData(null);
  };

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] || null;
    setFile(selected);
    if (selected && selected.size > 4 * 1024 * 1024) setNotice("Görsel en fazla 4 MB olabilir.");
    else setNotice("");
  };

  if (authenticated === null) {
    return <main className="admin-shell"><div className="admin-loading">Admin paneli hazırlanıyor…</div></main>;
  }

  if (!authenticated) {
    return (
      <main className="admin-shell admin-login-shell">
        <section className="admin-login-card">
          <p className="eyebrow">PUZZLEBEYOND / YÖNETİM</p>
          <h1>Admin paneli</h1>
          <p className="admin-muted">Bu alan yalnızca site sahibinin parolasıyla açılır.</p>
          {!configured && <p className="admin-error">Vercel’de <code>ADMIN_PASSWORD</code> tanımlanmamış.</p>}
          <form onSubmit={login} className="admin-login-form">
            <label><span>Admin parolası</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" autoFocus /></label>
            <button className="primary-button full" type="submit" disabled={busy || !configured}>{busy ? "KONTROL EDİLİYOR…" : "PANELE GİR →"}</button>
          </form>
          {notice && <p className="admin-error">{notice}</p>}
          <Link className="admin-back-link" href="/">← Ana sayfaya dön</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <div><p className="eyebrow">PUZZLEBEYOND / YÖNETİM</p><h1>Admin paneli</h1></div>
        <div className="admin-top-actions"><Link className="outline-button" href="/">SİTEYE DÖN</Link><button className="text-button" onClick={logout}>ÇIKIŞ</button></div>
      </header>
      <section className="admin-content">
        <div className="admin-overview">
          <div className="admin-stat-card"><span>ŞU ANDA</span><strong>{data?.activeUsers ?? "—"}</strong><b>AKTİF KULLANICI</b><button className="outline-button" onClick={() => void load()} disabled={busy}>YENİLE ↻</button></div>
          <div className="admin-note-card"><span>GÜVENLİK</span><p>Parola sunucuda tutulur; bu panelin oturumu HttpOnly çerez ile korunur.</p></div>
        </div>
        <section className="admin-section admin-sessions-section">
          <div className="admin-section-heading">
            <div><p className="eyebrow">CANLI İZLEME</p><h2>Aktif oturumlar</h2></div>
            <div className="admin-session-heading-actions"><span className="admin-count">{data?.sessions.length ?? 0} OTURUM</span><button className="outline-button" onClick={() => void load()} disabled={busy}>YENİLE</button><button className="admin-session-close-all" onClick={() => void closeAllSessions()} disabled={busy || !data?.sessions.length}>HEPSİNİ KAPAT</button></div>
          </div>
          {data?.sessions.length ? (
            <div className="admin-session-list">
              {data.sessions.map((session) => (
                <article className="admin-session-row" key={session.clientId}>
                  <div className="admin-session-main"><i className="admin-session-dot" /><div><b>{session.roomCode ? `${session.roomCode} odası` : "Ana menü"}</b><small>{session.clientId.slice(0, 12)}…</small></div></div>
                  <div className="admin-session-seen"><span>SON GÖRÜLME</span><b>{session.lastSeenLabel}</b></div>
                  <div className="admin-session-actions"><button className="outline-button" onClick={() => void closeSession(session)} disabled={busy}>KAPAT</button><button className="admin-delete-button" onClick={() => void deleteSession(session)} disabled={busy}>SİL</button></div>
                </article>
              ))}
            </div>
          ) : <p className="admin-session-empty">Şu anda aktif oturum bulunmuyor.</p>}
          <p className="admin-session-note">Kapatılan oturumların heartbeat isteği durdurulur; silme işlemi yalnızca kaydı kaldırır.</p>
        </section>
        <section className="admin-section">
          <div className="admin-section-heading"><div><p className="eyebrow">YENİ İÇERİK</p><h2>Galeriye puzzle ekle</h2></div><span className="admin-count">{data?.puzzles.length ?? 0} PUZZLE</span></div>
          <form className="admin-add-form" onSubmit={addPuzzle}>
            <label><span>Başlık</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} placeholder="Örn. Yaz akşamı" required /></label>
            <label><span>Açıklama</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={200} placeholder="Kısa bir açıklama" rows={2} /></label>
            <div className="admin-form-row"><label><span>Satır</span><input type="number" min={2} max={32} value={rows} onChange={(event) => setRows(event.target.value)} /></label><label><span>Sütun</span><input type="number" min={2} max={32} value={cols} onChange={(event) => setCols(event.target.value)} /></label><label><span>Vurgu</span><input type="color" value={accent} onChange={(event) => setAccent(event.target.value)} /></label></div>
            <label className="admin-file-label"><span>Görsel · JPG, PNG veya WebP · en fazla 4 MB</span><input id="admin-image" type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseFile} required /><b>{file ? file.name : "Dosya seç"}</b></label>
            <button className="primary-button" type="submit" disabled={busy}>{busy ? "YÜKLENİYOR…" : "GALERİYE EKLE →"}</button>
          </form>
        </section>
        {notice && <p className="admin-notice">{notice}</p>}
        <section className="admin-section">
          <div className="admin-section-heading"><div><p className="eyebrow">YAYINDAKİLER</p><h2>Galeri puzzleları</h2></div></div>
          <div className="admin-puzzle-grid">
            {data?.puzzles.map((puzzle) => (
              <article className="admin-puzzle-card" key={puzzle.id}>
                {puzzle.imageUrl ? <img src={puzzle.imageUrl} alt="" /> : <div className="admin-puzzle-placeholder" style={{ background: puzzle.accent }} />}
                <div className="admin-puzzle-copy"><b>{puzzle.title}</b><small>{puzzle.description || "Açıklama yok."}</small><span>{puzzle.count} PARÇA · {puzzle.rows}×{puzzle.cols}</span><button className="admin-delete-button" onClick={() => void removePuzzle(puzzle)} disabled={busy}>ÇIKAR</button></div>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
