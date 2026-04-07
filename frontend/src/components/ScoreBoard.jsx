export default function ScoreBoard({ players = [] }) {
  const sorted = [...players].sort((a, b) => b.score - a.score)

  return (
    <div className="score-board">
      <strong>Scores (this game)</strong>
      <table>
        <tbody>
          {sorted.map(p => (
            <tr key={p.user_id}>
              <td>{p.username}</td>
              <td style={{ textAlign: 'right', fontWeight: 700, color: p.score >= 0 ? '#4ade80' : '#f87171' }}>
                {p.score > 0 ? `+${p.score}` : p.score}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
