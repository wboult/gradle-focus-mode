package com.example;

public class Project009 {
    public static void main(String[] args) {
        System.out.println("Hello from project-009");
        new Project005().doSomething();
        new Project002().doSomething();
    }

    public void doSomething() {
        System.out.println("project-009 doing something");
    }
}
