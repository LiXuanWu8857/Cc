export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 640 }}>
      <h1>FoodTrack</h1>
      <p>
        Backend foundation. See <code>docs/</code> for the security architecture,
        database schema and API spec.
      </p>
      <p>
        Phase 2 endpoints: <code>/api/profile</code>, <code>/api/body-metrics</code>,{" "}
        <code>/api/nutrition-targets</code>.
      </p>
    </main>
  );
}
