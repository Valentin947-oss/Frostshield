import { useEffect, useState } from "react";
import { connectWallet, explainError, shortAddr, txLink, NETWORK } from "./lib/chain.js";
import { useChainState } from "./lib/useChain.js";
import Overview from "./components/Overview.jsx";
import BuyPolicy from "./components/BuyPolicy.jsx";
import MyPolicies from "./components/MyPolicies.jsx";
import FrostEvents from "./components/FrostEvents.jsx";
import OraclePanel from "./components/OraclePanel.jsx";

const TABS = [
  { id: "overview", label: "Преглед" },
  { id: "buy", label: "Купи полиса" },
  { id: "mine", label: "Мои полиси" },
  { id: "events", label: "Мразеви" },
  { id: "oracle", label: "Оракул" },
];

export default function App() {
  const { state, error, reload } = useChainState();
    const isAdmin = new URLSearchParams(window.location.search).has("admin");
  const [tab, setTab] = useState("overview");
  const [wallet, setWallet] = useState(null);
  const [toast, setToast] = useState(null);

  async function connect() {
    try {
      setWallet(await connectWallet());
    } catch (err) {
      setToast({ kind: "error", text: explainError(err) });
    }
  }

  useEffect(() => {
    if (!window.ethereum) return;
    const onChange = () => { setWallet(null); };
    window.ethereum.on?.("accountsChanged", onChange);
    window.ethereum.on?.("chainChanged", onChange);
    return () => {
      window.ethereum.removeListener?.("accountsChanged", onChange);
      window.ethereum.removeListener?.("chainChanged", onChange);
    };
  }, []);

  useEffect(() => {
    if (!toast || toast.kind === "error") return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  const notify = (t) => { setToast(t); if (t.kind === "ok") reload(); };
  const props = { state, wallet, onConnect: connect, notify, onNavigate: setTab, onDone: () => setTab("mine") };

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">FrostShield</span>
        </div>
        <nav className="tabs" aria-label="Главно мени">
          {TABS.filter((t) => t.id !== "oracle" || isAdmin).map((t) => (
            <button key={t.id} className={tab === t.id ? "tab active" : "tab"} aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <button className={wallet ? "btn wallet on" : "btn wallet"} onClick={connect} title={NETWORK.name}>
          {wallet ? shortAddr(wallet.address) : "Поврзи паричник"}
        </button>
      </header>

      {toast && (
        <div className={`toast ${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"}>
          <span>{toast.text}</span>
          {toast.hash && (txLink(toast.hash)
            ? <a href={txLink(toast.hash)} target="_blank" rel="noreferrer">Види трансакција</a>
            : <code title={toast.hash}>{toast.hash.slice(0, 10)}…</code>)}
          <button className="link" onClick={() => setToast(null)} aria-label="Затвори">Затвори</button>
        </div>
      )}

      <main>
        {error && <section className="panel error-panel"><h2>Нема врска со синџирот</h2><p>{error}</p></section>}
        {!state && !error && <p className="loading">Го читам синџирот…</p>}
        {state && tab === "overview" && <Overview {...props} />}
        {state && tab === "buy" && <BuyPolicy {...props} />}
        {state && tab === "mine" && <MyPolicies {...props} />}
        {state && tab === "events" && <FrostEvents {...props} />}
        {state && tab === "oracle" && <OraclePanel {...props} />}
      </main>

      <footer className="foot">
        Проценка на штети од доцни пролетни мразеви кај рано градинарство, Струмичко-Гевгелиски регион. Мрежа: {NETWORK.name}.
      </footer>
    </div>
  );
}
