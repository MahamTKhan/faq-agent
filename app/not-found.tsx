export default function NotFound() {
  return (
    <main className="center-screen">
      <div className="stack" style={{ textAlign: "center", maxWidth: 420 }}>
        <h1>Link not found</h1>
        <p className="muted">This link isn&apos;t valid or is no longer active. Please contact the project team for a new one.</p>
      </div>
    </main>
  );
}
