def outer_function
if True
for i in range(3)
print(i)
else
print("done")
else
print("bad indent here")

class Outer
def inner_method
if False
print("wrong indent")
else
print("fixed")