import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { primaryRoutes, RoutePlaceholder } from "./routes";
import { AppShell } from "./AppShell";
import { BoxesPage } from "../features/boxes/BoxesPage";
import { InventoryPage } from "../features/inventory/InventoryPage";
import { BomImportPage } from "../features/bom/BomImportPage";
import { WeldingPage } from "../features/welding/WeldingPage";
import { MovementsPage } from "../features/movements/MovementsPage";
import { SettingsPage } from "../features/settings/SettingsPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/inventory" replace />} />
          {primaryRoutes.map((route) => <Route key={route.id} path={route.path} element={route.id === "inventory" ? <InventoryPage /> : route.id === "boxes" ? <BoxesPage /> : route.id === "bom" ? <BomImportPage /> : route.id === "welding" ? <WeldingPage /> : route.id === "movements" ? <MovementsPage /> : route.id === "settings" ? <SettingsPage /> : <RoutePlaceholder />} />)}
          <Route path="*" element={<RoutePlaceholder />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
