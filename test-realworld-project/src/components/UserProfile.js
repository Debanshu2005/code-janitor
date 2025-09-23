import React, { useState } from 'react'

function UserProfile({ user }) {
  let [isEditing, setIsEditing] = useState(false)
  let [tempName, setTempName] = useState(user.name)
  
  const handleSave = function() {
    user.name = tempName;
    setIsEditing(false);
    console.log("User saved:", user);
  }
  
  return (
    <div className="profile">
      {isEditing ? (
        <input 
          value={tempName} 
          onChange={(e) => setTempName(e.target.value)}
        />
      ) : (
        <h2>{user.name}</h2>
      )}
      <button onClick={() => setIsEditing(!isEditing)}>
        {isEditing ? 'Cancel' : 'Edit'}
      </button>
      {isEditing && (
        <button onClick={handleSave}>
          Save
        </button>
      )}
    </div>
  )
}

export default UserProfile