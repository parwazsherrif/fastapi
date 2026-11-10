# part 1 load the database url

import os
from dotenv import load_dotenv

load_dotenv()
database_url = os.getenv("DATABASE_URL")

if not database_url:
    raise RuntimeError("DATABASE_URL is not set. Add it in .env or docker-compose.yml.")


# part 2 -> create the engine
from sqlalchemy import create_engine, text

engine = create_engine(database_url)
with engine.connect() as conn:
    version = conn.execute(text("SELECT VERSION()")).scalar()
    print(f"connected {version.split(',')[0]}")

# part 3 -> create session and db using sessionmaker and student database
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy import String, Integer, Column

session = sessionmaker(bind=engine)
db = session()

class Base(DeclarativeBase):
    pass


class StudentBase(Base):
    __tablename__='student_records'
    id=Column(String,primary_key=True)
    name=Column(String(50),nullable=False)        #data base records
    age=Column(Integer,nullable=False)
    course=Column(String(50),nullable=False)
    marks=Column(Integer,nullable=False)
    email=Column(String,unique=True,nullable=False)
    
    
Base.metadata.create_all(bind=engine)
print('table ready')
    
#part 4-> create shemas for input using pydantic
from pydantic import BaseModel,EmailStr,Field,field_validator,computed_field,ConfigDict


#class Course(BaseModel):
    #course:Literal['Web development','Artificial Intelligence','Full Stack','Java Developer']


class validate(BaseModel):   #pydantic model
    id:str=Field(...,description="Give the id of the student",example='S001')
    name:str=Field(...,min_length=2,max_length=100)
    age:int=Field(...,lt=40,ge=10)
    course:str=Field(...)
    marks:float=Field(...,le=100,gt=10)
    email:EmailStr=Field(...)
    
    @field_validator('name')
    @classmethod
    def correct(cls,value):
        if not value.replace(" ","").isalpha():
            raise ValueError("name should not contain any numeric values")
        return value.title()
    
        
class stdupdate_vali(BaseModel):
    name: str|None=Field(None,min_length=4,max_length=100)
    age:int|None=Field(None,ge=18,lt=40)
    course:str|None=Field(None,min_length=1,max_length=100)
    marks:float|None=Field(None,ge=0,le=100)
    email:EmailStr|None=None

    @field_validator('name')
    @classmethod
    def correct(cls, value):
        if value is not None and not value.replace(" ", "").isalpha():
            raise ValueError("name should not contain any numeric values")
        return value.title() if value is not None else value
        
    
    # part 6 -> pydantic schemas for output (studentresponse,studentpage,message)
    # from_attributes=TRue lets pydantic read student.marks (an object),not only student['marks']
class studentresponse(validate):
        model_config=ConfigDict(from_attributes=True)  #this converts dictionary into object
        @computed_field
        @property
        def grade(self)->str:
            if self.marks >=90:
                    return "A+"
            elif self.marks >=80:
                    return "A"
            elif self.marks >=70:
                    return "B"
            elif self.marks >=55:
                    return "C"
            else:
                    return "F"
    
    
    
    
    
    
    
    
    #part 7-> getdb() one session per request
    #opens a session,gives it to the endpoint,always closes it ,replaces load_data/save_data fuctions used in playground.py
def get_db():
    db=session()  # session open here
    try:
        yield db  # pause the session until the request is completed
    finally:
        db.close()
            
            
# part->8 create an app from fastapi
from fastapi import FastAPI,Path,Depends,HTTPException
app=FastAPI()

#part->9 get one student
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
# depend(get_db) -> before running the endpoint run this and tell me what it returns

@app.get('/student/{student_id}',response_model=studentresponse,tags=['GET ROUTE'])
def get_student(
    student_id:str=Path(...,examples=['S001']),
    db :Session =Depends (get_db)                  # creating a session
):
    student=db.get(StudentBase,student_id)
    if student is None:
        raise HTTPException(status_code=404,detail=f'student with {student_id} is not found')
    return student



# create a post route
@app.post('/create',response_model=studentresponse,status_code=201,tags=['POST ROUTE'])
def createstd(student: validate, db: Session = Depends(get_db)):
    if db.get(StudentBase, student.id) is not None:
        raise HTTPException(status_code=400, detail="the student already exist")
    new_std = StudentBase(**student.model_dump())
    db.add(new_std)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="email already exist...,try with new one")

    db.refresh(new_std)
    return new_std


# create a put route
@app.put('/updatestudent/{std_id}',tags=['PUT ROUTE'])
def update(
    student_up:stdupdate_vali,
    std_id:str=Path(...,description='please provide the id to update'),
    db:Session=Depends(get_db)
):
    student=db.get(StudentBase,std_id)
    if student is None:
        raise HTTPException(status_code=404,detail="the student doesn't exist")
    changes=student_up.model_dump(exclude_unset=True)
    
    
    for key,value in changes.items():
        setattr(student,key,value)   #setatt(object,key,value)
    try:
            
      db.commit()
    except IntegrityError:
        db.rollback()        # cancel everything the session did since the lastcommit
        raise HTTPException(status_code=400,detail="email already exist...,try with new one")
        
    db.refresh(student)
    return student


# create a delete route
@app.delete('/delete/{std_id}',tags=['DELETE ROUTE'])
def delect(std_id:str=Path(...),
    db:Session=Depends(get_db)):
    student=db.get(StudentBase,std_id)
    if student is None:
        raise HTTPException(status_code=404,detail='the student not found')
    db.delete(student)
    db.commit()
    return 'Student details deleted succesfully'  


# get all students (filter,sort,paginate) 
from fastapi import Query
from sqlalchemy import func
Sort_Filters=['marks','age','name']
Sort_order=['asc','desc']
@app.get('/students',tags=['GET ROUTE'])
def get_all(course:str|None=Query(None,description='show the student with this course'),
        sort_by:str|None=Query(None,description='sort by marks,age or name'),
        order:str|None=Query('asc',description='order by either asc or desc'),
        page:int=Query(1,ge=1,description='please provide the page'),
        limit:int=Query(2,ge=1,lt=100,description='please set the limit of your page'),
        db:Session=Depends(get_db)):
    if sort_by is not None and sort_by not in Sort_Filters:
        raise HTTPException(status_code=400,detail=f'the choice is invalid make choices from {Sort_Filters}')
    
    if order not in Sort_order:
            raise HTTPException(status_code=400,detail=f'the choice is invalid make choices from {Sort_order}')
    
    query=db.query(StudentBase)  #replacement of select * from student_records
    
    if course:
        query=query.filter(func.lower(StudentBase.course)==course.strip().lower()) # where course==(given course that need to be filtered)
    total=query.count()
    
    
    if sort_by:
        col=getattr(StudentBase,sort_by)
        if order =='desc':
            query=query.order_by(col.desc())
        else:
            query=query.order_by(col.asc())
            
    else:
        query=query.order_by(StudentBase.id)
        
    start=(page-1)*limit
    std=query.offset(start).limit(limit).all()
    return{
        "page":page,
        "limit":limit,
        "total_students":total,
        "students":std
    }
            
            
    
        