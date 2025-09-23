# Top-level function
def outer_function
  print("correct")  # already fine
    print("wrong indent")  # should fix

  if True
   for i in range(3)
        print(i)
   else:
       print("done")

  else
    print("bad indent here")

# Class with nested method
class Outer
  def inner_method
    if False
     print("wrong indent")
    else
      print("fixed")

# Already correct function
def good_function():
    print("ok")

# Random print
print("top-level print")