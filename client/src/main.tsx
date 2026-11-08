import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Home } from './Home.tsx';
import { useToasts } from './lib/store.ts';
import { Room } from './Room.tsx';
import './styles.css';

function route(): { kind: 'home' } | { kind: 'room'; id: string } {
  const m = /^\/r\/([a-z0-9]{4,16})\/?$/.exec(location.pathname);
  return m ? { kind: 'room', id: m[1] } : { kind: 'home' };
}

function Toasts() {
  const list = useToasts();
  return (
    <div class="toasts" aria-live="polite">
      {list.map((t) => (
        <div class={`toast ${t.kind}`} key={t.id}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

function App() {
  const [r, setR] = useState(route());
  useEffect(() => {
    const f = () => setR(route());
    window.addEventListener('popstate', f);
    return () => window.removeEventListener('popstate', f);
  }, []);
  return (
    <>
      {r.kind === 'room' ? <Room key={r.id} roomId={r.id} /> : <Home />}
      <Toasts />
    </>
  );
}

render(<App />, document.getElementById('app')!);
