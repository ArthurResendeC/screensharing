import { Component, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

// Sem isto, qualquer erro de render desmonta a árvore inteira e sobra uma página em
// branco. O relato ao servidor sai dos callbacks do createRoot (app.tsx), que também
// recebem o componentStack; aqui só se troca o branco por uma saída.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main className="crash-screen" role="alert">
        <h1>Algo deu errado</h1>
        <p>
          O ReShare encontrou um erro e parou de desenhar a página. O erro foi
          registrado; recarregar costuma resolver.
        </p>
        <pre className="error mono">{error.message}</pre>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => location.reload()}
        >
          Recarregar
        </button>
      </main>
    );
  }
}
