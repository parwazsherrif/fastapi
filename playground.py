"python will interact with postgresql without any fastapi endpoint here"

# step 1 get the url from the .env file
import os
import sys
from sqlalchemy import create_engine,text,Column,String,Integer
from sqlalchemy.orm import DeclarativeBase,sessionmaker
from dotenv import load_dotenv
load_dotenv()
database_url=os.getenv("Database_URL")
print(database_url)
print(sys.executable)


# step 2 build the engine -> the road to database
engine =  create_engine(database_url)
with engine.connect() as conn:
    version=conn.execute(text("SELECT version()")).scalar()   # to check that the database is connected
    print(f"connected to {version.split(',')[0]}")



class Base(DeclarativeBase):  #declarative class= sqlalchemy give the power to create table and it is parentclass
    pass                       # we create our base once every table inherit from this
                                #like pydantic:basemodel gives validation
                                #in declarativebase :gives the table piower 

class StudentBase(Base):
    __tablename__='student_records'
    id=Column(String,primary_key=True)
    name=Column(String(50),nullable=False)        #data base records
    age=Column(Integer,nullable=False)
    course=Column(String(50),nullable=False)
    marks=Column(Integer,nullable=False)
    email=Column(String,unique=True,nullable=False)
    
    
# bind=engine -> evert session travels to this road
Base.metadata.create_all(bind=engine)  # creating a table
print("table ready")



# step 4 session= one visit,open,do work,commit, close 
Session_local=sessionmaker(bind=engine)

db=Session_local()
   
if db.get(StudentBase,"S001") is None:
    db.add(StudentBase(id="S001",
                       name="parwaz",
                       age=19,
                       course="ML",
                       marks=96,
                       email="parwazsherrif@gmail.com"))
    db.commit()



# read it back from the database    
for i in db.query(StudentBase).all():
    print(i.id,i.name,i.age,i.course,i.marks,i.email)
    

# update the existing record
change=db.get(StudentBase,'S001')
change.marks=67
db.commit()   # dirctly you can change



    
    
    