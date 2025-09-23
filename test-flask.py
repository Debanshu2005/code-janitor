from flask import Flask, jsonify
app = Flask(__name__)

@app.route('/')
def hello:
    return jsonify({"message": "Hello"})

@app.route('/users')
def get_users:
    users = [{"id": 1, "name": "John"}, {"id": 2, "name": "Jane"}]
    return jsonify(users)

@app.route('/users/<int:user_id>')
def get_user(user_id):
    user = {"id": user_id, "name": "User " + str(user_id)}
    return jsonify(user)

if __name__ == '__main__':
    app.run(debug=True)