"""Course (class) management API routes."""

import secrets
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.v1.auth import get_current_user
from app.repositories.course import Course
from app.repositories.user import User
from app.core.schemas.course import (
    CourseCreateRequest,
    CourseJoinRequest,
    CourseListResponse,
    CourseResponse,
    CourseUpdateRequest,
)
from app.services.research_config_service import research_config_service

router = APIRouter(prefix="/courses", tags=["courses"])


def generate_invite_code() -> str:
    """Generate 6-digit random invite code."""
    return secrets.token_hex(3).upper()[:6]


@router.get("", response_model=CourseListResponse)
async def get_courses(
    current_user: User = Depends(get_current_user),
) -> CourseListResponse:
    """Get courses (Teacher sees own courses, Student sees joined courses)."""
    if current_user.role == "teacher":
        courses = await Course.find(Course.teacher_id == str(current_user.id)).to_list()
    elif current_user.role == "student":
        # Find courses where student is in the students array
        from beanie.operators import In
        courses = await Course.find(In(Course.students, [str(current_user.id)])).to_list()
    else:
        # Admin can see all courses
        courses = await Course.find().to_list()

    return CourseListResponse(
        courses=[
            CourseResponse(
                id=str(c.id),
                name=c.name,
                teacher_id=c.teacher_id,
                semester=c.semester,
                invite_code=c.invite_code,
                students=c.students,
                description=c.description,
                experiment_template_key=c.experiment_template_key,
                experiment_template_label=c.experiment_template_label,
                experiment_template_release_id=c.experiment_template_release_id,
                experiment_template_release_note=c.experiment_template_release_note,
                experiment_template_source=c.experiment_template_source,
                experiment_template_bound_at=c.experiment_template_bound_at,
                initial_task_document_title=c.initial_task_document_title,
                initial_task_document_content=c.initial_task_document_content,
                created_at=c.created_at,
                updated_at=c.updated_at,
            )
            for c in courses
        ]
    )


@router.post("", response_model=CourseResponse, status_code=status.HTTP_201_CREATED)
async def create_course(
    course_data: CourseCreateRequest,
    current_user: User = Depends(get_current_user),
) -> CourseResponse:
    """Create a new course (Teacher only)."""
    if current_user.role not in ["teacher", "admin"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only teachers can create courses",
        )

    # Generate unique invite code
    invite_code = generate_invite_code()
    while await Course.find_one(Course.invite_code == invite_code):
        invite_code = generate_invite_code()

    # Create course
    from datetime import datetime

    new_course = Course(
        name=course_data.name,
        teacher_id=str(current_user.id),
        semester=course_data.semester,
        invite_code=invite_code,
        description=course_data.description,
        initial_task_document_title=course_data.initial_task_document_title,
        initial_task_document_content=course_data.initial_task_document_content,
    )
    if course_data.experiment_template_key:
        binding = await research_config_service.resolve_template_binding(course_data.experiment_template_key)
        if not binding:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Experiment template key is not available in admin releases or legacy presets",
            )
        research_config_service.apply_binding_to_course(new_course, binding)
    await new_course.insert()

    return CourseResponse(
        id=str(new_course.id),
        name=new_course.name,
        teacher_id=new_course.teacher_id,
        semester=new_course.semester,
        invite_code=new_course.invite_code,
        students=new_course.students,
        description=new_course.description,
        experiment_template_key=new_course.experiment_template_key,
        experiment_template_label=new_course.experiment_template_label,
        experiment_template_release_id=new_course.experiment_template_release_id,
        experiment_template_release_note=new_course.experiment_template_release_note,
        experiment_template_source=new_course.experiment_template_source,
        experiment_template_bound_at=new_course.experiment_template_bound_at,
        initial_task_document_title=new_course.initial_task_document_title,
        initial_task_document_content=new_course.initial_task_document_content,
        created_at=new_course.created_at,
        updated_at=new_course.updated_at,
    )


@router.get("/{course_id}", response_model=CourseResponse)
async def get_course(
    course_id: str,
    current_user: User = Depends(get_current_user),
) -> CourseResponse:
    """Get course details."""
    course = await Course.get(course_id)
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found",
        )

    # Check access
    if current_user.role not in ["admin", "teacher"]:
        if str(current_user.id) not in course.students:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have access to this course",
            )

    return CourseResponse(
        id=str(course.id),
        name=course.name,
        teacher_id=course.teacher_id,
        semester=course.semester,
        invite_code=course.invite_code,
        students=course.students,
        description=course.description,
        experiment_template_key=course.experiment_template_key,
        experiment_template_label=course.experiment_template_label,
        experiment_template_release_id=course.experiment_template_release_id,
        experiment_template_release_note=course.experiment_template_release_note,
        experiment_template_source=course.experiment_template_source,
        experiment_template_bound_at=course.experiment_template_bound_at,
        initial_task_document_title=course.initial_task_document_title,
        initial_task_document_content=course.initial_task_document_content,
        created_at=course.created_at,
        updated_at=course.updated_at,
    )


@router.put("/{course_id}", response_model=CourseResponse)
async def update_course(
    course_id: str,
    course_data: CourseUpdateRequest,
    current_user: User = Depends(get_current_user),
) -> CourseResponse:
    """Update course (Teacher/Owner only)."""
    course = await Course.get(course_id)
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found",
        )

    # Check permission
    if (
        str(current_user.id) != course.teacher_id
        and current_user.role != "admin"
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only course owner can update course",
        )

    from datetime import datetime

    if course_data.name:
        course.name = course_data.name
    if course_data.description is not None:
        course.description = course_data.description
    if "experiment_template_key" in course_data.model_fields_set:
        if course_data.experiment_template_key:
            binding = await research_config_service.resolve_template_binding(course_data.experiment_template_key)
            if not binding:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Experiment template key is not available in admin releases or legacy presets",
                )
            research_config_service.apply_binding_to_course(course, binding)
        else:
            research_config_service.clear_course_binding(course)
    if course_data.initial_task_document_title is not None:
        course.initial_task_document_title = course_data.initial_task_document_title
    if course_data.initial_task_document_content is not None:
        course.initial_task_document_content = course_data.initial_task_document_content
    course.updated_at = datetime.utcnow()

    await course.save()

    return CourseResponse(
        id=str(course.id),
        name=course.name,
        teacher_id=course.teacher_id,
        semester=course.semester,
        invite_code=course.invite_code,
        students=course.students,
        description=course.description,
        experiment_template_key=course.experiment_template_key,
        experiment_template_label=course.experiment_template_label,
        experiment_template_release_id=course.experiment_template_release_id,
        experiment_template_release_note=course.experiment_template_release_note,
        experiment_template_source=course.experiment_template_source,
        experiment_template_bound_at=course.experiment_template_bound_at,
        initial_task_document_title=course.initial_task_document_title,
        initial_task_document_content=course.initial_task_document_content,
        created_at=course.created_at,
        updated_at=course.updated_at,
    )


@router.delete("/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_course(
    course_id: str,
    current_user: User = Depends(get_current_user),
) -> None:
    """Delete course (Teacher/Owner only)."""
    course = await Course.get(course_id)
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found",
        )

    # Check permission
    if (
        str(current_user.id) != course.teacher_id
        and current_user.role != "admin"
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only course owner can delete course",
        )

    await course.delete()


@router.post("/join", status_code=status.HTTP_200_OK)
async def join_course(
    join_data: CourseJoinRequest,
    current_user: User = Depends(get_current_user),
) -> dict:
    """Join a course using invite code (Student only)."""
    if current_user.role != "student":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only students can join courses",
        )

    # Find course by invite code
    course = await Course.find_one(Course.invite_code == join_data.invite_code)
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invalid invite code",
        )

    # Check if already a member
    if str(current_user.id) in course.students:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You are already a member of this course",
        )

    # Add student to course
    course.students.append(str(current_user.id))
    await course.save()

    # Update user's class_id
    current_user.class_id = str(course.id)
    await current_user.save()

    return {"message": "Successfully joined course", "course_id": str(course.id)}


@router.get("/{course_id}/students")
async def get_course_students(
    course_id: str,
    current_user: User = Depends(get_current_user),
) -> dict:
    """Get course students list."""
    course = await Course.get(course_id)
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found",
        )

    # Check access
    if current_user.role not in ["admin", "teacher"]:
        if str(current_user.id) != course.teacher_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have access to this course",
            )

    # Get student details
    from app.repositories.user import User

    students = []
    for student_id in course.students:
        student = await User.get(student_id)
        if student:
            students.append(
                {
                    "id": str(student.id),
                    "username": student.username,
                    "email": student.email,
                    "avatar_url": student.avatar_url,
                }
            )

    return {"students": students}


@router.post("/{course_id}/students")
async def add_student_to_course(
    course_id: str,
    student_id: str,
    current_user: User = Depends(get_current_user),
) -> dict:
    """Add student to course (Teacher only)."""
    course = await Course.get(course_id)
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found",
        )

    # Check permission
    if (
        str(current_user.id) != course.teacher_id
        and current_user.role != "admin"
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only course owner can add students",
        )

    from app.repositories.user import User as UserModel

    student = await UserModel.get(student_id)
    if not student or student.role != "student":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student not found",
        )

    if student.class_id and student.class_id != str(course.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Student already belongs to another class",
        )

    # Check if already a member
    if student_id in course.students:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Student is already a member of this course",
        )

    # Add student
    course.students.append(student_id)
    await course.save()
    student.class_id = str(course.id)
    await student.save()

    return {"message": "Student added successfully"}


@router.delete("/{course_id}/students/{student_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_student_from_course(
    course_id: str,
    student_id: str,
    current_user: User = Depends(get_current_user),
) -> None:
    """Remove student from course (Teacher only)."""
    course = await Course.get(course_id)
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found",
        )

    # Check permission
    if (
        str(current_user.id) != course.teacher_id
        and current_user.role != "admin"
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only course owner can remove students",
        )

    from app.repositories.user import User as UserModel

    # Remove student
    if student_id in course.students:
        course.students.remove(student_id)
        await course.save()
        student = await UserModel.get(student_id)
        if student and student.class_id == str(course.id):
            student.class_id = None
            await student.save()
