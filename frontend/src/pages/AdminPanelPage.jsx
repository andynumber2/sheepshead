export default function AdminPanelPage({ onNavigate }) {
  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ margin: 0 }}>Admin Panel</h2>
        <button className="outline" onClick={() => onNavigate('/lobby')}>← Back to lobby</button>
      </div>

      <article
        style={{ cursor: 'pointer', marginBottom: 0 }}
        onClick={() => onNavigate('/account-management')}
      >
        <h4 style={{ margin: '0 0 4px' }}>Account Management</h4>
        <p style={{ margin: 0, color: '#888', fontSize: '0.9rem' }}>
          View, edit, and delete user accounts.
        </p>
      </article>
    </div>
  )
}
