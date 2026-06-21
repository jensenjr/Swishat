import HomePage from './pages/HomePage';
import CollectionPage from './pages/CollectionPage';
import AdminPage from './pages/AdminPage';

function getRoute() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts[0] === 'c' && parts[2] === 'admin') return 'admin';
  if (parts[0] === 'c' && parts[1]) return 'collection';
  return 'home';
}

export default function App() {
  const route = getRoute();
  if (route === 'admin') return <AdminPage />;
  if (route === 'collection') return <CollectionPage />;
  return <HomePage />;
}
