package com.example;

public class Project004 {
    public static void main(String[] args) {
        System.out.println("Hello from project-004");
        new Project003().doSomething();
        new Project001().doSomething();
    }

    public void doSomething() {
        System.out.println("project-004 doing something");
    }
}
