let React = require('react')
let useState = React.useState

function MyComponent() {
    let [count, setCount] = useState(0)
    let increment = function() {
        setCount(count + 1);
        console.log("Count increased");
    }
    
    return React.createElement('div', null, 
        React.createElement('p', null, 'Count: ' + count),
        React.createElement('button', { onClick: increment }, 'Increment')
    )
}

module.exports = MyComponent;