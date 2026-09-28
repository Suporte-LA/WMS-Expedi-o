import { Component } from "react";
import type { ReactNode } from "react";

export class RouteErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  render() {
    if (this.state.failed) return <main className="p-6 space-y-4" role="alert">
      <p>Não foi possível carregar esta tela. Confira sua conexão e tente novamente.</p>
      <button type="button" className="rounded-lg bg-teal-700 px-4 py-2 text-white" onClick={() => window.location.reload()}>
        Recarregar
      </button>
    </main>;
    return this.props.children;
  }
}
