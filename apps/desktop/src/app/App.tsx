import { BrowserRouter, Link, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { primaryRoutes, RoutePlaceholder } from "./routes";
import { BoxesPage } from "../features/boxes/BoxesPage";
import { InventoryPage } from "../features/inventory/InventoryPage";

function Shell() {
  return (
    <div className="app-shell">
      <header className="app-header"><h1>PartNest</h1></header>
      <div className="app-body">
        <nav aria-label="主导航">
          {primaryRoutes.map((route) => <Link key={route.id} to={route.path}>{route.label}</Link>)}
        </nav>
        <main><Outlet /></main>
      </div>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Navigate to="/inventory" replace />} />
          {primaryRoutes.map((route) => <Route key={route.id} path={route.path} element={route.id === "inventory" ? <InventoryPage /> : route.id === "boxes" ? <BoxesPage /> : <RoutePlaceholder />} />)}
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
