let API_BASE = 'https://api.example.com'

export function fetchUser(userId) {
  return fetch(API_BASE + '/users/' + userId)
    .then(response => {
      if (!response.ok) {
        throw new Error('HTTP error: ' + response.status)
      }
      return response.json();
    })
    .then(data => {
      let user = transformUserData(data)
      return user;
    })
    .catch(error => {
      console.error('Fetch error:', error);
      throw error
    })
}

function transformUserData(rawData) {
  let transformed = {
    id: rawData.id,
    name: rawData.first_name + ' ' + rawData.last_name,
    email: rawData.email_address,
    isActive: rawData.status === 'active'
  }
  return transformed
}