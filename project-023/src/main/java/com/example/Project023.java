package com.example;

public class Project023 {
    public static void main(String[] args) {
        System.out.println("Hello from project-023");
        new Project021().doSomething();
        new Project007().doSomething();
        new Project020().doSomething();
    }

    public void doSomething() {
        System.out.println("project-023 doing something");
    }
}
