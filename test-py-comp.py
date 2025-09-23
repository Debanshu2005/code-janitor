# Function definitions
def simple_function:
    return "hello"

def function_with_args(a, b, c):
    return a + b + c

# Class definitions  
class SimpleClass:
    def method_one:
        return "method one"
        
    def method_two(self, param):
        return f"method {param}"

# Control flow statements
if True:
    print("if without colon")
elif False  :
    print("elif without colon")
else:
    print("else without colon")

# Loops
for i in range(5):
    print(i)
    
while True:
    print("while without colon")

# Error handling
try
    risky_operation()
except ValueError:
    handle_error()
finally
    cleanup()

# Context managers
with open("file.txt"):
    read_content()

# Already correct (should not change)
def good_function():
    print("already has colon")

print("this should not get a colon")